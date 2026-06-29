import { config } from "../../../package.json";
import { MD5 } from "crypto-js";
import { Document } from "langchain/document";

type PDFPageText = {
  page: number;
  content: string;
};

type TreeNode = {
  title: string;
  node_id: string;
  start_page: number;
  end_page: number;
  summary: string;
  nodes?: TreeNode[];
};

type BuiltinIndex = {
  key: string;
  pages: PDFPageText[];
  tree: TreeNode[];
};

type RelatedPDFText = {
  text: string;
  docs: Document[];
};

const BUILTIN_CACHE_KEY = "__zoteroPageIndexBuiltinCache";

function logBuiltinPageIndex(stage: string, payload?: unknown) {
  ztoolkit.log(`[BuiltinPageIndex] ${stage}`, payload);
}

function getCache(): { [key: string]: BuiltinIndex } {
  const win = window as any;
  win[BUILTIN_CACHE_KEY] ??= {};
  return win[BUILTIN_CACHE_KEY];
}

function normalizeApiBase(api: string | undefined) {
  return (api || "https://api.longcat.chat/openai").replace(/\/(?:v1)?\/?$/, "");
}

function getLLMConfig() {
  return {
    secretKey: Zotero.Prefs.get(`${config.addonRef}.secretKey`),
    model: String(Zotero.Prefs.get(`${config.addonRef}.model`) || "LongCat-2.0-Preview"),
    api: normalizeApiBase(Zotero.Prefs.get(`${config.addonRef}.api`) as string),
  };
}

async function chatCompletion(prompt: string, temperature = 0) {
  const { secretKey, model, api } = getLLMConfig();
  if (!secretKey) {
    throw new Error("API Secret Key is not configured.");
  }
  const response = await Zotero.HTTP.request("POST", `${api}/v1/chat/completions`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secretKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      stream: false,
    }),
    responseType: "json",
  } as any);
  const rawResponse = response as any;
  const payload = rawResponse.response ?? rawResponse.xmlhttp?.response;
  return String(payload?.choices?.[0]?.message?.content || "");
}

function parseJSONFromText(text: string) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) {
    throw new Error("No JSON found in LLM response.");
  }
  return JSON.parse(match[0]);
}

function getCurrentPDFItem() {
  const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
  if (!reader) {
    throw new Error("No active Zotero PDF reader.");
  }
  return Zotero.Items.get(reader.itemID as number);
}

function mergeTextItems(items: any[]) {
  const lines: Array<{ x: number; y: number; text: string }> = [];
  const sortedItems = items
    .filter((item) => String(item.str || "").trim())
    .map((item) => ({
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      text: String(item.str || "").trim(),
      height: Number(item.height || 0),
    }))
    .sort((a, b) => {
      const yDiff = b.y - a.y;
      return Math.abs(yDiff) > Math.max(a.height, b.height, 1) / 2 ? yDiff : a.x - b.x;
    });

  for (const item of sortedItems) {
    const lastLine = lines[lines.length - 1];
    if (lastLine && Math.abs(lastLine.y - item.y) < Math.max(item.height, 1) / 2) {
      lastLine.text += `${lastLine.text.endsWith("-") ? "" : " "}${item.text}`;
    } else {
      lines.push({ x: item.x, y: item.y, text: item.text });
    }
  }

  return lines
    .map((line) => line.text)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractCurrentPDFPages(): Promise<PDFPageText[]> {
  logBuiltinPageIndex("extract:start");
  const reader = (await ztoolkit.Reader.getReader()) as _ZoteroTypes.ReaderInstance;
  const iframeWindow = reader?._iframeWindow as any;
  const PDFViewerApplication =
    iframeWindow?.wrappedJSObject?.PDFViewerApplication || iframeWindow?.PDFViewerApplication;
  if (!PDFViewerApplication) {
    throw new Error("Cannot access Zotero PDF reader parser.");
  }

  await PDFViewerApplication.pdfLoadingTask?.promise;
  await PDFViewerApplication.pdfViewer?.pagesPromise;

  const pageViews = PDFViewerApplication.pdfViewer?._pages || [];
  const pageTexts: PDFPageText[] = [];
  for (let index = 0; index < pageViews.length; index++) {
    const pageView = pageViews[index];
    const pdfPage = pageView.pdfPage || (await PDFViewerApplication.pdfDocument?.getPage(index + 1));
    if (!pdfPage) {
      continue;
    }
    const textContent = await pdfPage.getTextContent();
    const content = mergeTextItems(textContent.items || []);
    pageTexts.push({ page: index + 1, content });
    logBuiltinPageIndex("extract:page", {
      page: index + 1,
      chars: content.length,
      preview: content.slice(0, 200),
    });
  }

  if (!pageTexts.some((page) => page.content.trim())) {
    throw new Error("This PDF has no extractable text layer. OCR is required before AskPDF can use it.");
  }
  logBuiltinPageIndex("extract:done", {
    pages: pageTexts.length,
    chars: pageTexts.reduce((sum, page) => sum + page.content.length, 0),
  });
  return pageTexts;
}

function groupPages(pages: PDFPageText[], maxChars = 18000) {
  const groups: PDFPageText[][] = [];
  let current: PDFPageText[] = [];
  let currentChars = 0;
  for (const page of pages) {
    const nextChars = page.content.length;
    if (current.length && currentChars + nextChars > maxChars) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(page);
    currentChars += nextChars;
  }
  if (current.length) {
    groups.push(current);
  }
  return groups;
}

function formatPagesForTreePrompt(pages: PDFPageText[]) {
  return pages
    .map((page) => `[[PAGE ${page.page}]]\n${page.content.slice(0, 8000)}`)
    .join("\n\n");
}

function createFallbackTree(pages: PDFPageText[]): TreeNode[] {
  return pages.map((page, index) => {
    const title =
      page.content
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length >= 4 && line.length <= 120) || `Page ${page.page}`;
    return {
      title: title.replace(/^#+\s*/, ""),
      node_id: String(index + 1).padStart(4, "0"),
      start_page: page.page,
      end_page: page.page,
      summary: page.content.replace(/\s+/g, " ").slice(0, 800),
    };
  });
}

function normalizeRawTree(rawTree: any, pageCount: number): TreeNode[] {
  let nodeCounter = 0;
  const normalizeNode = (rawNode: any): TreeNode | undefined => {
    const title = String(rawNode?.title || rawNode?.node_title || "").trim();
    const startPage = Number(rawNode?.physical_index || rawNode?.start_page || rawNode?.page);
    if (!title || !Number.isFinite(startPage)) {
      return undefined;
    }
    nodeCounter += 1;
    const children = Array.isArray(rawNode.nodes)
      ? rawNode.nodes.map(normalizeNode).filter(Boolean) as TreeNode[]
      : [];
    return {
      title,
      node_id: String(nodeCounter).padStart(4, "0"),
      start_page: Math.max(1, Math.min(pageCount, Math.floor(startPage))),
      end_page: Math.max(1, Math.min(pageCount, Math.floor(startPage))),
      summary: String(rawNode.summary || "").slice(0, 800),
      ...(children.length ? { nodes: children } : {}),
    };
  };
  const source = Array.isArray(rawTree) ? rawTree : rawTree?.nodes;
  const tree = (Array.isArray(source) ? source : []).map(normalizeNode).filter(Boolean) as TreeNode[];
  const assignEndPages = (nodes: TreeNode[], parentEnd: number) => {
    nodes.sort((a, b) => a.start_page - b.start_page);
    for (let index = 0; index < nodes.length; index++) {
      const nextSibling = nodes[index + 1];
      nodes[index].end_page = nextSibling
        ? Math.max(nodes[index].start_page, nextSibling.start_page - 1)
        : parentEnd;
      if (nodes[index].nodes?.length) {
        assignEndPages(nodes[index].nodes!, nodes[index].end_page);
      }
    }
  };
  assignEndPages(tree, pageCount);
  return tree;
}

async function buildTreeWithLLM(pages: PDFPageText[]): Promise<TreeNode[]> {
  const groups = groupPages(pages);
  const generatedNodes: any[] = [];
  logBuiltinPageIndex("tree:llm-start", {
    pages: pages.length,
    groups: groups.map((group) => ({
      from: group[0].page,
      to: group[group.length - 1].page,
      chars: group.reduce((sum, page) => sum + page.content.length, 0),
    })),
  });

  for (let index = 0; index < groups.length; index++) {
    const previousTree = JSON.stringify(generatedNodes).slice(0, 20000);
    const prompt =
      "You build a hierarchical table of contents for a PDF from page text.\n" +
      "Return JSON only as an array of nodes. Each node must be shaped as " +
      "{\"title\":\"...\",\"physical_index\":1,\"nodes\":[]}.\n" +
      "Use concise section titles from the document text. physical_index is the real [[PAGE n]] where the section starts.\n" +
      "Do not create one node per page unless the document has no visible section structure.\n" +
      (index === 0
        ? "Create the initial tree from this first page group.\n\n"
        : `Existing tree so far:\n${previousTree}\n\nContinue the tree using only the new page group. Return only new root-level nodes or continuations that start in this group.\n\n`) +
      `Page group:\n${formatPagesForTreePrompt(groups[index])}`;
    const content = await chatCompletion(prompt, 0);
    logBuiltinPageIndex("tree:llm-response", {
      group: index + 1,
      content: content.slice(0, 2000),
    });
    const parsed = parseJSONFromText(content);
    const nodes = Array.isArray(parsed) ? parsed : parsed.nodes;
    if (Array.isArray(nodes)) {
      generatedNodes.push(...nodes);
    }
  }

  const tree = normalizeRawTree(generatedNodes, pages.length);
  if (!tree.length) {
    throw new Error("LLM did not return a usable tree.");
  }
  logBuiltinPageIndex("tree:built", {
    nodes: tree.length,
    titles: tree.slice(0, 20).map((node) => ({
      start_page: node.start_page,
      end_page: node.end_page,
      title: node.title,
      summaryChars: node.summary.length,
    })),
  });
  return tree;
}

async function buildTree(pages: PDFPageText[]): Promise<TreeNode[]> {
  try {
    return await buildTreeWithLLM(pages);
  } catch (error) {
    logBuiltinPageIndex("tree:fallback", error);
    const tree = createFallbackTree(pages);
    logBuiltinPageIndex("tree:built", {
      nodes: tree.length,
      titles: tree.slice(0, 20).map((node) => ({
        start_page: node.start_page,
        end_page: node.end_page,
        title: node.title,
        summaryChars: node.summary.length,
      })),
    });
    return tree;
  }
}

async function ensureCurrentPDFIndexed(): Promise<BuiltinIndex> {
  const pdfItem = getCurrentPDFItem();
  logBuiltinPageIndex("index:start", {
    itemID: pdfItem.id,
    key: pdfItem.key,
    title: pdfItem.getField?.("title"),
  });
  const pages = await extractCurrentPDFPages();
  const hash = MD5(pages.map((page) => `${page.page}\n${page.content}`).join("\n\n")).toString();
  const cacheKey = `${pdfItem.key}:${hash}`;
  const cache = getCache();
  if (!cache[cacheKey]) {
    logBuiltinPageIndex("index:cache-miss", { cacheKey, hash });
    cache[cacheKey] = {
      key: cacheKey,
      pages,
      tree: await buildTree(pages),
    };
  } else {
    logBuiltinPageIndex("index:cache-hit", { cacheKey, hash });
  }
  logBuiltinPageIndex("index:done", {
    cacheKey,
    pages: cache[cacheKey].pages.length,
    treeNodes: cache[cacheKey].tree.length,
  });
  return cache[cacheKey];
}

function parsePageSelection(content: string, pageCount: number, maxPages: number) {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return [];
  }
  const parsed = JSON.parse(match[0]);
  const rawPages = String(parsed.pages || "");
  const pages = new Set<number>();
  for (const part of rawPages.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-", 2).map((value) => Number(value.trim()));
      for (let page = Math.min(start, end); page <= Math.max(start, end); page++) {
        if (page >= 1 && page <= pageCount) {
          pages.add(page);
        }
      }
    } else {
      const page = Number(trimmed);
      if (page >= 1 && page <= pageCount) {
        pages.add(page);
      }
    }
    if (pages.size >= maxPages) {
      break;
    }
  }
  return [...pages].slice(0, maxPages);
}

function keywordFallbackPages(question: string, pages: PDFPageText[], maxPages: number) {
  const terms = (question.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]{2,}/g) || []).slice(0, 20);
  const scored = pages.map((page) => {
    const text = page.content.toLowerCase();
    const score = terms.reduce((sum, term) => {
      const matches = text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      return sum + (matches?.length || 0);
    }, 0);
    return { page: page.page, score };
  });
  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages)
    .map((item) => item.page);
  const fallbackPages = selected.length ? selected : pages.slice(0, maxPages).map((page) => page.page);
  logBuiltinPageIndex("select:fallback", {
    question,
    terms,
    pages: fallbackPages,
    topScores: scored.sort((a, b) => b.score - a.score).slice(0, 10),
  });
  return fallbackPages;
}

async function selectRelevantPages(question: string, index: BuiltinIndex, maxPages: number) {
  const { secretKey, model, api } = getLLMConfig();
  const treeText = JSON.stringify(index.tree).slice(0, 60000);

  logBuiltinPageIndex("select:start", {
    question,
    maxPages,
    model,
    api,
    treeChars: treeText.length,
    totalPages: index.pages.length,
  });

  if (!secretKey) {
    logBuiltinPageIndex("select:no-secret-key");
    return keywordFallbackPages(question, index.pages, maxPages);
  }

  try {
    const content = await chatCompletion(
      "Select the most relevant PDF pages for the question from the hierarchical tree. " +
      `Return JSON only as {\"pages\":\"1,3-4\",\"reason\":\"...\"}. Use at most ${maxPages} pages.\n\n` +
      `Question:\n${question}\n\nPage tree:\n${treeText}`,
      0,
    );
    const selectedPages = parsePageSelection(content, index.pages.length, maxPages);
    logBuiltinPageIndex("select:llm-response", {
      content,
      selectedPages,
    });
    return selectedPages.length ? selectedPages : keywordFallbackPages(question, index.pages, maxPages);
  } catch (error) {
    ztoolkit.log("Built-in PageIndex page selection failed", error);
    return keywordFallbackPages(question, index.pages, maxPages);
  }
}

export async function queryCurrentPDF(queryText: string): Promise<RelatedPDFText> {
  logBuiltinPageIndex("query:start", { queryText });
  const pdfItem = getCurrentPDFItem();
  const index = await ensureCurrentPDFIndexed();
  const relatedNumber = Number(Zotero.Prefs.get(`${config.addonRef}.relatedNumber`) || 5);
  const selectedPages = await selectRelevantPages(queryText, index, relatedNumber);
  const docs = selectedPages
    .map((pageNumber) => index.pages.find((page) => page.page === pageNumber))
    .filter(Boolean)
    .map((page) => new Document({
      pageContent: page!.content,
      metadata: {
        type: "box",
        box: {
          page: page!.page - 1,
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        },
        key: pdfItem.key,
      },
    }));

  if (!docs.length) {
    throw new Error("Built-in PageIndex did not find any relevant PDF text.");
  }

  logBuiltinPageIndex("query:done", {
    selectedPages,
    docs: docs.map((doc: Document) => ({
      page: doc.metadata.box.page + 1,
      chars: doc.pageContent.length,
      preview: doc.pageContent.slice(0, 200),
    })),
  });

  return {
    text: docs.map((doc: Document, indexNumber: number) => `[${indexNumber + 1}]${doc.pageContent}`).join("\n\n"),
    docs,
  };
}
