import { config } from "../../../package.json";
import { queryCurrentPDF } from "./PageIndex";
import { runtimeLog, withRuntimeLog } from "./RuntimeLogger";

type DocumentNode = {
  id: string;
  type: "selection" | "annotation" | "related_context" | "selected_item";
  title: string;
  parentId: string | null;
  preview: string;
};

function trimText(text: unknown, maxLength = 1200) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getSelectedItems() {
  try {
    return ZoteroPane.getSelectedItems() as Zotero.Item[];
  } catch {
    return [];
  }
}

function getPDFSelection() {
  try {
    return ztoolkit.Reader.getSelectedText(
      Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)
    );
  } catch {
    return "";
  }
}

function getCurrentPdfItem() {
  try {
    const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
    return reader ? Zotero.Items.get(reader.itemID as number) : undefined;
  } catch {
    return undefined;
  }
}

async function getPDFAnnotations(select = false) {
  let keys: string[] = [];
  if (select) {
    const reader = await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance;
    const nodes = reader._iframeWindow?.document.querySelectorAll("[id^=annotation-].selected") as any;
    keys = [...nodes].map((node) => node.id.split("-")[1]);
  }
  const pdfItem = getCurrentPdfItem();
  if (!pdfItem) {
    runtimeLog("DocumentTools", "annotations:no_pdf_item", { select }, "warn");
    return "";
  }
  const docs: string[] = [];
  pdfItem.getAnnotations().forEach((annotation: any) => {
    if (select && keys.indexOf(annotation.key) === -1) {
      return;
    }
    docs.push(annotation.annotationText);
  });
  runtimeLog("DocumentTools", "annotations:built", {
    select,
    count: docs.length,
    pdfItemKey: pdfItem.key,
  });
  return docs.map((text, index) => `[${index + 1}]${text}`).join("\n\n");
}

async function getRelatedText(query: string) {
  return withRuntimeLog("DocumentTools", "related_text", {
    query,
    selectedIndex: Zotero_Tabs.selectedIndex,
  }, async () => {
  if (Zotero_Tabs.selectedIndex !== 0) {
    const relatedPDF = await queryCurrentPDF(query);
    if (relatedPDF.docs.length) {
      Zotero[config.addonInstance].views.insertAuxiliary(relatedPDF.docs);
    }
    return relatedPDF.text;
  }

  return getSelectedItems()
    .map((item, index) => `[${index + 1}]${JSON.stringify(item.toJSON())}`)
    .join("\n\n");
  });
}

export async function getCurrentDocumentContent(query = "") {
  return withRuntimeLog("DocumentTools", "current_document_content", { query }, async () => {
    const selection = getPDFSelection();
    if (selection.trim()) {
      return {
        source: "pdf_selection",
        contentLength: selection.length,
        content: selection,
      };
    }

    if (Zotero_Tabs.selectedIndex !== 0) {
      const content = await getRelatedText(query || "summary");
      return {
        source: "pageindex",
        contentLength: content.length,
        content,
      };
    }

    const items = getSelectedItems();
    return {
      source: "selected_items",
      itemCount: items.length,
      content: items.map((item) => item.toJSON()).slice(0, 20),
    };
  });
}

export async function getCurrentDocumentStructure(query = "") {
  return withRuntimeLog("DocumentTools", "current_document_structure", { query }, async () => {
    const nodes: DocumentNode[] = [];
    const selection = getPDFSelection();
    if (selection.trim()) {
      nodes.push({
        id: "pdf-selection",
        type: "selection",
        title: "Current PDF selection",
        parentId: null,
        preview: trimText(selection, 300),
      });
    }

    const pdfItem = getCurrentPdfItem();
    if (pdfItem) {
      nodes.push({
        id: "pdf-related-context",
        type: "related_context",
        title: String(pdfItem.getField?.("title") || "Current PDF related context"),
        parentId: null,
        preview: `Use get_node_content with nodeId "pdf-related-context" to retrieve relevant text for the user query.`,
      });

      const annotations = await getPDFAnnotations(false);
      if (annotations.trim()) {
        nodes.push({
          id: "pdf-annotations",
          type: "annotation",
          title: "PDF annotations",
          parentId: null,
          preview: trimText(annotations, 300),
        });
      }
    }

    getSelectedItems().slice(0, 20).forEach((item, index) => {
      nodes.push({
        id: `selected-item-${item.id || index}`,
        type: "selected_item",
        title: String(item.getField?.("title") || item.key || `Selected item ${index + 1}`),
        parentId: null,
        preview: trimText(JSON.stringify(item.toJSON()), 300),
      });
    });

    if (!nodes.length && query.trim()) {
      const related = await getRelatedText(query);
      nodes.push({
        id: "related-context",
        type: "related_context",
        title: "Related context",
        parentId: null,
        preview: trimText(related, 300),
      });
    }

    runtimeLog("DocumentTools", "structure:nodes", {
      count: nodes.length,
      nodeIds: nodes.map((node) => node.id),
    });
    return nodes;
  });
}

export async function getDocumentNodeContent(nodeId: string, query = "") {
  return withRuntimeLog("DocumentTools", "node_content", { nodeId, query }, async () => {
    if (nodeId === "pdf-selection") {
      return getPDFSelection();
    }
    if (nodeId === "pdf-annotations") {
      return getPDFAnnotations(false);
    }
    if (nodeId === "pdf-related-context" || nodeId === "related-context") {
      return getRelatedText(query || "summary");
    }

    const selectedItemPrefix = "selected-item-";
    if (nodeId.startsWith(selectedItemPrefix)) {
      const id = Number(nodeId.slice(selectedItemPrefix.length));
      const item = getSelectedItems().find((candidate) => candidate.id === id);
      if (item) {
        return item.toJSON();
      }
    }

    throw new Error(`Unknown document node: ${nodeId}`);
  });
}

export async function searchDocumentNodes(query: string) {
  return withRuntimeLog("DocumentTools", "search_nodes", { query }, async () => {
    const text = await getRelatedText(query);
    return {
      query,
      results: [text].map((pageContent, index) => ({
        id: `search-result-${index + 1}`,
        preview: trimText(pageContent, 500),
        metadata: {
          type: "related_context",
          key: config.addonRef,
        },
      })),
    };
  });
}
