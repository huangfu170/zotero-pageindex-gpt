import { config } from "../../../package.json";
import { Document } from "langchain/document";

type PageIndexStatus = "queued" | "indexing" | "completed" | "failed";

type PageIndexIndexResponse = {
  docId?: string;
  status: PageIndexStatus;
  message?: string;
  error?: string;
};

type PageIndexContext = {
  page: number;
  content: string;
};

type PageIndexQueryResponse = {
  docId: string;
  pages?: string;
  contexts: PageIndexContext[];
  trace?: string;
  error?: string;
};

type RelatedPDFText = {
  text: string;
  docs: Document[];
};

function getServiceUrl() {
  const prefKey = `${config.addonRef}.pageIndexServiceUrl`;
  const value = Zotero.Prefs.get(prefKey) as string;
  return (value || "http://127.0.0.1:8765").replace(/\/+$/, "");
}

function getPageIndexEnabled() {
  const prefKey = `${config.addonRef}.pageIndexEnabled`;
  const value = Zotero.Prefs.get(prefKey);
  return value !== false;
}

async function pageIndexRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await Zotero.HTTP.request(method, `${getServiceUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    responseType: "json",
  } as any);

  const rawResponse = response as any;
  const payload =
    rawResponse.response ??
    rawResponse.responseText ??
    rawResponse.xmlhttp?.responseText ??
    rawResponse.xmlhttp?.response;
  if (typeof payload === "string") {
    return JSON.parse(payload) as T;
  }
  return payload as T;
}

function getCurrentPDFItem() {
  const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
  if (!reader) {
    throw new Error("No active Zotero PDF reader.");
  }
  return Zotero.Items.get(reader.itemID as number);
}

async function getAttachmentPath(pdfItem: Zotero.Item) {
  const getter = (pdfItem as any).getFilePath;
  const filePath =
    typeof getter === "function" ? await getter.call(pdfItem) : (pdfItem as any).attachmentPath;
  if (!filePath) {
    throw new Error("The current PDF attachment does not have a local file path.");
  }
  return filePath;
}

function showProgress(title: string, text: string, type: "default" | "success" | "fail" = "default") {
  new ztoolkit.ProgressWindow(title, { closeOtherProgressWindows: true })
    .createLine({ text, type })
    .show();
}

export async function health() {
  return pageIndexRequest<{ ok: boolean; version?: string }>("GET", "/health");
}

export async function ensureCurrentPDFIndexed() {
  if (!getPageIndexEnabled()) {
    throw new Error("PageIndex is disabled in preferences.");
  }

  const pdfItem = getCurrentPDFItem();
  const pdfPath = await getAttachmentPath(pdfItem);
  const response = await pageIndexRequest<PageIndexIndexResponse>("POST", "/index", {
    zoteroItemKey: pdfItem.key,
    attachmentKey: pdfItem.key,
    pdfPath,
  });

  if (response.error) {
    throw new Error(response.error);
  }
  return response;
}

export async function queryCurrentPDF(queryText: string): Promise<RelatedPDFText> {
  const pdfItem = getCurrentPDFItem();
  const index = await ensureCurrentPDFIndexed();

  if (index.status !== "completed" || !index.docId) {
    const message =
      index.message ||
      "PageIndex is building the index for this PDF. Ask again after indexing finishes.";
    showProgress("PageIndex", message);
    return {
      text: `[PageIndex] ${message}`,
      docs: [],
    };
  }

  const relatedNumber = Zotero.Prefs.get(`${config.addonRef}.relatedNumber`) as number;
  const result = await pageIndexRequest<PageIndexQueryResponse>("POST", "/query", {
    docId: index.docId,
    question: queryText,
    maxPages: relatedNumber || 5,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  const docs = result.contexts.map((context) => {
    const pageIndex = Math.max(0, Number(context.page || 1) - 1);
    return new Document({
      pageContent: context.content,
      metadata: {
        type: "box",
        box: {
          page: pageIndex,
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        },
        key: pdfItem.key,
      },
    });
  });

  return {
    text: docs.map((doc: Document, index: number) => `[${index + 1}]${doc.pageContent}`).join("\n\n"),
    docs,
  };
}
