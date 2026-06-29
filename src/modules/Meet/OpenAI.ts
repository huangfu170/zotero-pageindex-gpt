import { config } from "../../../package.json";
import { MD5 } from "crypto-js"
import { Document } from "langchain/document";
import LocalStorage from "../localStorage";
import Views from "../views";
import Meet from "./api";
import { getRuntimeLogPath, runtimeLog, withRuntimeLog } from "./RuntimeLogger";
const similarity = require('compute-cosine-similarity');
declare type RequestArg = { headers: any, api: string, body: Function, remove?: string | RegExp, process?: Function }
const REQUEST_PRESETS = {
  longcat: {
    api: "https://api.longcat.chat/openai",
    model: "LongCat-2.0-Preview"
  },
  deepseek: {
    api: "https://api.deepseek.com",
    model: "deepseek-chat"
  },
  openai: {
    api: "https://api.openai.com",
    model: "gpt-4o-mini"
  },
  openrouter: {
    api: "https://openrouter.ai/api",
    model: "openai/gpt-4o-mini"
  }
} as const;

function normalizeApiBase(api: string | undefined) {
  return (api || "").replace(/\/(?:v1)?\/?$/, "")
}

function getRequestConfig() {
  const provider = String(Zotero.Prefs.get(`${config.addonRef}.apiProvider`) || "custom").trim().toLowerCase() as keyof typeof REQUEST_PRESETS | "custom"
  const preset = REQUEST_PRESETS[provider as keyof typeof REQUEST_PRESETS]
  const api = normalizeApiBase(
    (Zotero.Prefs.get(`${config.addonRef}.api`) as string) ||
    preset?.api ||
    "https://api.longcat.chat/openai"
  )
  const model = ((Zotero.Prefs.get(`${config.addonRef}.model`) as string) || preset?.model || "LongCat-2.0-Preview")
  return { provider: provider in REQUEST_PRESETS ? provider : "custom", api, model }
}
let chatID: string
const requestArgs: RequestArg[] = [
  {
    api: "https://aigpt.one/api/chat-stream",
    headers: {
      "path": "v1/chat/completions"
    },
    body: (requestText: string, messages: any) => { 
      return {
        "model": "gpt-3.5-turbo",
        messages: messages,
        stream: true,
        "max_tokens": 2000,
        "presence_penalty": 0
      }
    } 
  },
  {
    api: "https://chatbot.theb.ai/api/chat-process",
    headers: {
    },
    body: (requestText: string, messages: any) => {
      return { "prompt": requestText, "options": { "parentMessageId": chatID }}
    },
    process: (text: string) => {
      const res = JSON.parse(text.split("\n").slice(-1)[0])
      chatID = res.id
      return res.text
    }
  }
]

/**
 * 给定文本和文档，返回文档列表，返回最相似的几个
 * @param queryText 
 * @param docs 
 * @param obj 
 * @returns 
 */
export async function similaritySearch(queryText: string, docs: Document[], obj: { key: string }) {
  return withRuntimeLog("OpenAI", "similarity_search", {
    queryText,
    inputDocCount: docs.length,
    key: obj.key,
  }, async () => {
  const storage = Meet.Global.storage = Meet.Global.storage || new LocalStorage(config.addonRef)
  await storage.lock.promise;
  const embeddings = new OpenAIEmbeddings() as any
  // 查找本地，为节省空间，只储存向量
  // 因为随着插件更新，解析出的PDF可能会有优化，因此再此进行提取MD5值作为验证
  // 但可以预测，本地JSON文件可能会越来越大
  const id = MD5(docs.map((i: any) => i.pageContent).join("\n\n")).toString()
  await storage.lock
  const _vv = storage.get(obj, id)
  ztoolkit.log(_vv)
  let vv: any
  if (_vv) {
    Meet.Global.popupWin.createLine({ text: "Reading embeddings...", type: "default" })
    vv = _vv
  } else {
    Meet.Global.popupWin.createLine({ text: "Generating embeddings...", type: "default" })
    vv = await embeddings.embedDocuments(docs.map((i: any) => i.pageContent))
    window.setTimeout(async () => {
      await storage.set(obj, id, vv)
    })
  }

  const v0 = await embeddings.embedQuery(queryText)
  // 从20个里面找出文本最长的几个，防止出现较短但相似度高的段落影响回答准确度
  const relatedNumber = Zotero.Prefs.get(`${config.addonRef}.relatedNumber`) as number
  Meet.Global.popupWin.createLine({ text: `Searching ${relatedNumber} related content...`, type: "default" })
  const k = relatedNumber * 5
  const pp = vv.map((v: any) => similarity(v0, v));
  docs = [...pp].sort((a, b) => b - a).slice(0, k).map((p: number) => {
    return docs[pp.indexOf(p)]
  })
  // return docs.slice(0, relatedNumber)
  const result = docs.sort((a, b) => b.pageContent.length - a.pageContent.length).slice(0, relatedNumber)
  runtimeLog("OpenAI", "similarity_search:selected", {
    relatedNumber,
    selectedDocCount: result.length,
  })
  return result
  })
}


class OpenAIEmbeddings {
  constructor() {
  }
  private async request(input: string[]) {
    const views = Zotero[config.addonInstance].views as Views
    const { api } = getRequestConfig()
    const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
    const split_len = Number(Zotero.Prefs.get(`${config.addonRef}.embeddingBatchNum`) || 10)
    let res
    const url = `${api}/v1/embeddings`
    runtimeLog("OpenAI", "embeddings:start", {
      url,
      inputCount: input.length,
      batchSize: split_len,
    })
    if (!secretKey) {
      new ztoolkit.ProgressWindow(url, { closeOtherProgressWindows: true })
        .createLine({ text: "Your secretKey is not configured.", type: "default" })
        .show()
      return
    }
    let final_embeddings: any[] = []
    for (let i = 0; i < input.length; i += split_len) {

      const chunk = input.slice(i, i + split_len)
      runtimeLog("OpenAI", "embeddings:batch_start", {
        batchStart: i,
        batchCount: chunk.length,
        textLengths: chunk.map((text) => text.length),
      })
      try {
        res = await withRuntimeLog("OpenAI", "embeddings:request", {
          url,
          batchStart: i,
          batchCount: chunk.length,
        }, () => Zotero.HTTP.request(
          "POST",
          url,
          {
            responseType: "json",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${secretKey}`,
            },
            body: JSON.stringify({
              model: "text-embedding-ada-002",
              input: chunk
            }),
          }
        ))
      } catch (error: any) {
        runtimeLog("OpenAI", "embeddings:error", {
          batchStart: i,
          message: error?.message || String(error),
        }, "error")
        try {
          error = error.xmlhttp.response?.error
          views.setText(`# ${error.code}\n> ${url}\n\n**${error.type}**\n${error.message}`, true)
          new ztoolkit.ProgressWindow(error.code, { closeOtherProgressWindows: true })
            .createLine({ text: error.message, type: "default" })
            .show()
        } catch {
          new ztoolkit.ProgressWindow("Error", { closeOtherProgressWindows: true })
            .createLine({ text: error.message, type: "default" })
            .show()
        }
      }
      if (res?.response?.data) {
        final_embeddings = final_embeddings.concat(res.response.data.map((i: any) => i.embedding))
      }
    }
    runtimeLog("OpenAI", "embeddings:end", {
      outputCount: final_embeddings.length,
    })
    return final_embeddings
  }

  public async embedDocuments(texts: string[]) {
    return await this.request(texts)
  }

  public async embedQuery(text: string) {
    return (await this.request([text]))?.[0]
  }
}


export async function getGPTResponse(requestText: string) {
  runtimeLog("OpenAI", "get_gpt_response:start", {
    requestText,
    logPath: getRuntimeLogPath(),
  })
  const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
  // 这里可以补充很多免费API，然后用户设置用哪个
  if (!secretKey) {
    const message = "API Secret Key is not configured. Set it in Zotero preferences before asking.";
    new ztoolkit.ProgressWindow("LLM", { closeOtherProgressWindows: true })
      .createLine({ text: message, type: "fail" })
      .show()
    throw new Error(message)
  }
  try {
    const response = await getGPTResponseByAgent(requestText)
    runtimeLog("OpenAI", "get_gpt_response:end", {
      mode: "agent",
      responseLength: String(response || "").length,
    })
    return response
  } catch (error: any) {
    const views = Zotero[config.addonInstance].views as Views
    const lastMessage = views.messages[views.messages.length - 1]
    if (lastMessage?.role === "user" && lastMessage?.content === requestText) {
      views.messages.pop()
    }
    runtimeLog("OpenAI", "agent_fallback", {
      message: error?.message || String(error),
    }, "warn")
    new ztoolkit.ProgressWindow("Agent fallback", { closeOtherProgressWindows: true })
      .createLine({ text: error?.message || String(error), type: "fail" })
      .createLine({ text: "Falling back to the legacy chat request.", type: "default" })
      .show()
    const response = await getGPTResponseByRemote(requestText)
    runtimeLog("OpenAI", "get_gpt_response:end", {
      mode: "legacy",
      responseLength: String(response || "").length,
    })
    return response
  }
}

async function getGPTResponseByAgent(requestText: string) {
  return withRuntimeLog("OpenAI", "agent_response", { requestText }, async () => {
  const views = Zotero[config.addonInstance].views as Views
  views.messages.push({ role: "user", content: requestText })
  views.stopAlloutput()
  views.keepNextAnswerVisible()
  views.setText("")
  views.clearAgentToolTrace()

  const { getAgentResponse } = await import("./Agent")
  const responseText = await getAgentResponse(requestText, {
    onToolStart: (toolName, input) => views.addAgentToolTrace(toolName, input),
    onToolEnd: (traceId, output) => views.updateAgentToolTrace(traceId, output),
    onToolError: (traceId, error) => views.updateAgentToolTrace(traceId, error, true),
  })
  if (!responseText) {
    throw new Error("Empty response from OpenAI Agents SDK.")
  }
  views.setText(responseText, true)
  views.messages.push({ role: "assistant", content: responseText })
  return responseText
  })
}

async function getGPTResponseByRemote(requestText: string) {
  return withRuntimeLog("OpenAI", "legacy_chat_response", { requestText }, async () => {
  const views = Zotero[config.addonInstance].views as Views
  const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
  const temperature = Zotero.Prefs.get(`${config.addonRef}.temperature`)
  const maxTokens = Zotero.Prefs.get(`${config.addonRef}.maxTokens`)
  const { api, model } = getRequestConfig()
  const chatNumber = Zotero.Prefs.get(`${config.addonRef}.chatNumber`) as number
  const url = `${api}/v1/chat/completions`

  views.messages.push({ role: "user", content: requestText })
  views.stopAlloutput()
  views.setText("")

  try {
    const result = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        model,
        messages: views.messages.slice(-chatNumber),
        stream: false,
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
      }),
      responseType: "json",
    } as any)
    const rawResult = result as any
    const payload = rawResult.response ?? rawResult.xmlhttp?.response
    const responseText = payload?.choices?.[0]?.message?.content || ""
    if (!responseText) {
      throw new Error(`Empty response from ${url}`)
    }
    views.setText(responseText, true)
    views.messages.push({ role: "assistant", content: responseText })
    return responseText
  } catch (error: any) {
    let message = error?.message || String(error)
    try {
      const parsed = JSON.parse(error?.xmlhttp?.response || "{}").error
      message = parsed?.message || message
    } catch {}
    const errorText = `# LLM request failed\n> ${url}\n\n${message}`
    views.setText(errorText, true, false, false)
    new ztoolkit.ProgressWindow("LLM Error", { closeOtherProgressWindows: true })
      .createLine({ text: message, type: "fail" })
      .show()
    throw new Error(message)
  }
  })
}

/**
 * 所有getGPTResponseTextByXXX参照此函数实现
 * gpt-3.5-turbo / gpt-4
 * @param requestText 
 * @returns 
 */
export async function getGPTResponseByOpenAI(requestText: string) {
  const views = Zotero[config.addonInstance].views as Views
  const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
  const temperature = Zotero.Prefs.get(`${config.addonRef}.temperature`)
  const maxTokens = Zotero.Prefs.get(`${config.addonRef}.maxTokens`)
  const { api, model } = getRequestConfig()
  views.messages.push({
    role: "user",
    content: requestText
  })
  // outputSpan.innerText = responseText;
  const deltaTime = Zotero.Prefs.get(`${config.addonRef}.deltaTime`) as number
  // 储存上一次的结果
  let _textArr: string[] = []
  // 随着请求返回实时变化
  let textArr: string[] = []
  // 激活输出
  views.stopAlloutput()
  views.setText("")
  let responseText: string | undefined
  const id: number = window.setInterval(async () => {
    if (!responseText && _textArr.length == textArr.length) { return}
    _textArr = textArr.slice(0, _textArr.length + 1)
    let text = _textArr.join("")
    text.length > 0 && views.setText(text)
    if (responseText && responseText == text) {
      views.setText(text, true)
      window.clearInterval(id)
    }
  }, deltaTime)
  views._ids.push({
    type: "output",
    id: id
  })
  const chatNumber = Zotero.Prefs.get(`${config.addonRef}.chatNumber`) as number
  const url = `${api}/v1/chat/completions`
  try {
    await Zotero.HTTP.request(
      "POST",
      url,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: views.messages.slice(-chatNumber),
          stream: true,
          temperature: Number(temperature),
          max_tokens: Number(maxTokens),
        }),
        responseType: "text",
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          xmlhttp.onprogress = (e: any) => {
            try {
              textArr = e.target.response.match(/data: (.+)/g).filter((s: string) => s.indexOf("content") >= 0).map((s: string) => {
                try {
                  return JSON.parse(s.replace("data: ", "")).choices[0].delta.content.replace(/\n+/g, "\n")
                } catch {
                  return false
                }
              }).filter(Boolean)
            } catch {
              // 出错一般是token超出限制
              ztoolkit.log(e.target.response)
            }
            if (e.target.timeout) {
              e.target.timeout = 0;
            }
          };
        },
      }
    );
  } catch (error: any) {
    try {
      error = JSON.parse(error?.xmlhttp?.response).error
      textArr = [`# ${error.code}\n> ${url}\n\n**${error.type}**\n${error.message}`]
      new ztoolkit.ProgressWindow(error.code, { closeOtherProgressWindows: true })
        .createLine({ text: error.message, type: "default" })
        .show()
    } catch {
      new ztoolkit.ProgressWindow("Error", { closeOtherProgressWindows: true })
        .createLine({ text: error.message, type: "default" })
        .show()
    }
  }
  responseText = textArr.join("")
  ztoolkit.log("responseText", responseText)
  // if (views._ids.map(i=>i.id).indexOf(id) >= 0 ) {
  //   views.setText(responseText, true)
  // }
  // window.clearInterval(id)
  views.messages.push({
    role: "assistant",
    content: responseText
  })
  return responseText
}

/**
 * 返回值要是纯文本
 * @param requestArg
 * @param requestText 
 * @param views 
 * @returns 
 */
export async function getGPTResponseBy(
  requestArg: RequestArg,
  requestText: string,
) {
  const views = Zotero[config.addonInstance].views as Views
  const deltaTime = Zotero.Prefs.get(`${config.addonRef}.deltaTime`) as number
  let responseText: string | undefined
  let _responseText = ""
  views.messages.push({
    role: "user",
    content: requestText
  })
  // 储存上一次的结果
  // 激活输出
  views.stopAlloutput()
  views.setText("")
  const id = window.setInterval(() => {
    _responseText.trim().length > 0 && views.setText(_responseText)
    if (responseText && responseText == _responseText) {
      views.setText(_responseText, true)
      window.clearInterval(id)
    }
  }, deltaTime)
  views._ids.push({ type: "output", id: id })
  const chatNumber = Zotero.Prefs.get(`${config.addonRef}.chatNumber`) as number
  const body = JSON.stringify(requestArg.body(requestText, views.messages.slice(-chatNumber)))
  await Zotero.HTTP.request(
    "POST",
    requestArg.api,
    {
      headers: {
        "Content-Type": "application/json",
        ...requestArg.headers
      }, 
      body,
      responseType: "text",
      requestObserver: (xmlhttp: XMLHttpRequest) => {
        xmlhttp.onprogress = (e: any) => {
          _responseText = e.target.response.replace(requestArg.remove, "")
          if (requestArg.process) {
            _responseText = requestArg.process(_responseText)
          }
          if (e.target.timeout) {
            e.target.timeout = 0;
          }
        };
      },
    }
  );
  // if (views._ids.map(i => i.id).indexOf(id) >= 0) {
  //   views.setText(responseText, true)
  // }
  // window.clearInterval(id)
  // if (views.isInNote) {
  //   window.setTimeout(async () => {
  //     Meet.BetterNotes.replaceEditorText(
  //       // await Zotero.BetterNotes.api.convert.md2html(responseText)
  //       views.container.querySelector(".markdown-body")!.innerHTML
  //     )
  //   })
  // }
  responseText = _responseText
  views.messages.push({
    role: "assistant",
    content: responseText
  })
  return responseText
}
