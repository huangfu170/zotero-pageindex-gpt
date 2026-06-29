import { config } from "../../../package.json";
import {
  getCurrentDocumentContent,
  getCurrentDocumentStructure,
  getDocumentNodeContent,
  searchDocumentNodes,
} from "./DocumentTools";
import { runtimeLog, summarizeValue, withRuntimeLog } from "./RuntimeLogger";

type ChatRole = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: ChatRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: boolean;
    };
  };
};

type ToolExecutor = (input: any) => Promise<unknown>;

type DocumentTool = {
  definition: ToolDefinition;
  execute: ToolExecutor;
};

export type AgentToolTraceCallbacks = {
  onToolStart?: (toolName: string, input: unknown) => string | void;
  onToolEnd?: (traceId: string | void, output: unknown) => void;
  onToolError?: (traceId: string | void, error: unknown) => void;
};

const AGENT_INSTRUCTIONS = `
You are PageIndex for Zotero, a document QA assistant.

TOOL USE:
- For document-specific questions, call get_document_structure first to inspect the current Zotero context and identify relevant nodes.
- Call get_node_content only for the most relevant node ids returned by get_document_structure.
- Use search_document_nodes when the question names a topic but the relevant node is unclear from the structure.
- Use get_document_content only when the user explicitly asks for broad/full-context analysis or when structure/search cannot provide enough context.
- Keep retrieval tight. Do not fetch broad content when a targeted node can answer the question.
- Answer based only on tool output. If the available tools do not provide enough evidence, say what is missing.
- Be concise and answer in the same language as the user unless they request otherwise.
`.trim();

function normalizeApiBase(api: string | undefined) {
  return (api || "").replace(/\/(?:v1)?\/?$/, "");
}

function getAgentConfig() {
  const api = normalizeApiBase(
    (Zotero.Prefs.get(`${config.addonRef}.api`) as string) ||
      "https://api.openai.com"
  );
  const model = String(
    Zotero.Prefs.get(`${config.addonRef}.model`) || "gpt-4.1-mini"
  );
  const secretKey = String(Zotero.Prefs.get(`${config.addonRef}.secretKey`) || "");
  const temperature = Number(Zotero.Prefs.get(`${config.addonRef}.temperature`) || 0.7);
  const maxTokens = Number(Zotero.Prefs.get(`${config.addonRef}.maxTokens`) || 2000);
  return { api, model, secretKey, temperature, maxTokens };
}

function stringifyToolOutput(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function previewValue(value: unknown, maxLength = 600) {
  const text = stringifyToolOutput(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function parseToolArguments(rawArguments: string) {
  if (!rawArguments.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawArguments);
  } catch {
    return { rawArguments };
  }
}

async function chatCompletion(messages: ChatMessage[], tools: ToolDefinition[]) {
  const { api, model, secretKey, temperature, maxTokens } = getAgentConfig();
  const url = `${api}/v1/chat/completions`;
  const result = await withRuntimeLog("Agent", "chat_completion", {
    url,
    model,
    messageCount: messages.length,
    tools: tools.map((item) => item.function.name),
  }, () =>
    Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: "auto",
        stream: false,
        temperature,
        max_tokens: maxTokens,
      }),
      responseType: "json",
    } as any),
  );

  const rawResult = result as any;
  const payload = rawResult.response ?? rawResult.xmlhttp?.response;
  const message = payload?.choices?.[0]?.message;
  if (!message) {
    throw new Error(`Empty response from ${url}`);
  }
  return message as ChatMessage;
}

async function runTracedTool<T>(
  callbacks: AgentToolTraceCallbacks | undefined,
  toolName: string,
  input: unknown,
  execute: () => Promise<T>,
) {
  runtimeLog("Agent", "tool:start", { toolName, input });
  const traceId = callbacks?.onToolStart?.(toolName, input);
  try {
    const output = await execute();
    runtimeLog("Agent", "tool:end", {
      toolName,
      output: summarizeValue(output),
    });
    callbacks?.onToolEnd?.(traceId, output);
    return output;
  } catch (error) {
    runtimeLog("Agent", "tool:error", { toolName, error: String(error) }, "error");
    callbacks?.onToolError?.(traceId, error);
    throw error;
  }
}

function createTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  execute: ToolExecutor,
): DocumentTool {
  return {
    definition: {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          properties,
          required,
          additionalProperties: false,
        },
      },
    },
    execute,
  };
}

function createDocumentTools(callbacks?: AgentToolTraceCallbacks) {
  return [
    createTool(
      "get_document_structure",
      "Get the current Zotero document/context structure without full text. Use this first to find relevant node ids.",
      {
        query: {
          type: "string",
          description: "The user's topic or question, if available.",
        },
      },
      [],
      async ({ query = "" }) => {
        const input = { query };
        return runTracedTool(callbacks, "get_document_structure", input, () =>
          getCurrentDocumentStructure(input.query),
        );
      },
    ),
    createTool(
      "get_document_content",
      "Get broad available content for the current Zotero context. Use only when targeted structure/node retrieval is insufficient or the user asks for full-context analysis.",
      {
        query: {
          type: "string",
          description: "The user's topic or question, used to retrieve relevant PDF context.",
        },
      },
      [],
      async ({ query = "" }) => {
        const input = { query };
        return runTracedTool(callbacks, "get_document_content", input, () =>
          getCurrentDocumentContent(input.query),
        );
      },
    ),
    createTool(
      "get_node_content",
      "Get full content for a specific node returned by get_document_structure. Prefer tight, relevant node ids.",
      {
        nodeId: {
          type: "string",
          description: "The node id returned by get_document_structure.",
        },
        query: {
          type: "string",
          description: "The user's topic or question, used for related-context nodes.",
        },
      },
      ["nodeId"],
      async ({ nodeId, query = "" }) => {
        const input = { nodeId, query };
        return runTracedTool(callbacks, "get_node_content", input, () =>
          getDocumentNodeContent(input.nodeId, input.query),
        );
      },
    ),
    createTool(
      "search_document_nodes",
      "Search the current Zotero context for text related to the user's query when structure alone does not identify the relevant node.",
      {
        query: {
          type: "string",
          description: "The topic or question to search for.",
        },
      },
      ["query"],
      async ({ query }) => {
        const input = { query };
        return runTracedTool(callbacks, "search_document_nodes", input, () =>
          searchDocumentNodes(input.query),
        );
      },
    ),
  ];
}

export async function getAgentResponse(requestText: string, callbacks?: AgentToolTraceCallbacks) {
  const { api, model, secretKey } = getAgentConfig();
  if (!secretKey) {
    throw new Error("API Secret Key is not configured. Set it in Zotero preferences before asking.");
  }

  const documentTools = createDocumentTools(callbacks);
  const toolMap = new Map(documentTools.map((item) => [item.definition.function.name, item]));
  const tools = documentTools.map((item) => item.definition);
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_INSTRUCTIONS },
    { role: "user", content: requestText },
  ];

  runtimeLog("Agent", "start", {
    requestText,
    model,
    api,
    tools: tools.map((item) => item.function.name),
  });

  for (let turn = 0; turn < 8; turn++) {
    const assistantMessage = await chatCompletion(messages, tools);
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls || [];
    runtimeLog("Agent", "turn", {
      turn: turn + 1,
      toolCalls: toolCalls.map((item) => ({
        id: item.id,
        name: item.function.name,
        arguments: item.function.arguments,
      })),
      contentPreview: assistantMessage.content ? previewValue(assistantMessage.content) : "",
    });
    if (!toolCalls.length) {
      runtimeLog("Agent", "finish", {
        turns: turn + 1,
        answerLength: String(assistantMessage.content || "").length,
      });
      return String(assistantMessage.content || "");
    }

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = toolMap.get(toolName);
      const input = parseToolArguments(toolCall.function.arguments || "{}");
      let output: unknown;
      if (!tool) {
        output = { error: `Unknown tool: ${toolName}` };
      } else {
        try {
          output = await tool.execute(input);
        } catch (error: any) {
          output = { error: error?.message || String(error) };
        }
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: stringifyToolOutput(output),
      });
    }
  }

  throw new Error("Agent exceeded the maximum tool-calling turns.");
}
