import { Agent, OpenAIProvider, Runner, setOpenAIAPI, setTracingDisabled, tool } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "../../../package.json";
import {
  getCurrentDocumentContent,
  getCurrentDocumentStructure,
  getDocumentNodeContent,
  searchDocumentNodes,
} from "./DocumentTools";

const AGENT_INSTRUCTIONS = `
You are a Zotero document analysis assistant.
Use tools to inspect the current Zotero context before answering document-specific questions.
Prefer get_document_structure first, then get_node_content for specific nodes.
Use search_document_nodes when the user asks about a topic and the relevant node is unclear.
Do not invent document content that was not returned by tools.
Answer in the same language as the user unless they request otherwise.
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

function createDocumentTools() {
  return [
    tool({
      name: "get_document_structure",
      description:
        "Get a lightweight structure of the current Zotero context. Returns node ids, node types, titles, parent ids, and previews.",
      parameters: z.object({
        query: z.string().optional().describe("The user's topic or question, if available."),
      }),
      async execute({ query }) {
        return getCurrentDocumentStructure(query || "");
      },
    }),
    tool({
      name: "get_document_content",
      description:
        "Get the available content for the current Zotero context. Prefer more targeted tools when possible.",
      parameters: z.object({
        query: z.string().optional().describe("The user's topic or question, used to retrieve relevant PDF context."),
      }),
      async execute({ query }) {
        return getCurrentDocumentContent(query || "");
      },
    }),
    tool({
      name: "get_node_content",
      description:
        "Get full content for a node returned by get_document_structure.",
      parameters: z.object({
        nodeId: z.string().describe("The node id returned by get_document_structure."),
        query: z.string().optional().describe("The user's topic or question, used for related-context nodes."),
      }),
      async execute({ nodeId, query }) {
        return getDocumentNodeContent(nodeId, query || "");
      },
    }),
    tool({
      name: "search_document_nodes",
      description:
        "Search the current Zotero context for text related to the user's query.",
      parameters: z.object({
        query: z.string().describe("The topic or question to search for."),
      }),
      async execute({ query }) {
        return searchDocumentNodes(query);
      },
    }),
  ];
}

export async function getAgentResponse(requestText: string) {
  const { api, model, secretKey, temperature, maxTokens } = getAgentConfig();
  if (!secretKey) {
    throw new Error("API Secret Key is not configured. Set it in Zotero preferences before asking.");
  }

  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);

  const client = new OpenAI({
    apiKey: secretKey,
    baseURL: `${api}/v1`,
    dangerouslyAllowBrowser: true,
  });

  const runner = new Runner({
    modelProvider: new OpenAIProvider({
      openAIClient: client,
      useResponses: false,
      strictFeatureValidation: false,
    }),
    model,
    modelSettings: {
      temperature,
      maxTokens,
    },
    tracingDisabled: true,
  });

  const agent = new Agent({
    name: "Zotero Document Agent",
    instructions: AGENT_INSTRUCTIONS,
    model,
    tools: createDocumentTools(),
  });

  const result = await runner.run(agent, requestText, {
    maxTurns: 8,
  });
  return String(result.finalOutput || "");
}
