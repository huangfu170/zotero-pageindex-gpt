import { Document } from "langchain/document";
import { queryCurrentPDF as queryCurrentPDFBuiltin } from "./BuiltinPageIndex";
import { runtimeLog, withRuntimeLog } from "./RuntimeLogger";

type RelatedPDFText = {
  text: string;
  docs: Document[];
};

export async function queryCurrentPDF(queryText: string): Promise<RelatedPDFText> {
  runtimeLog("PageIndex", "query_current_pdf", { backend: "builtin", queryText });
  return withRuntimeLog("PageIndex", "query_builtin", { queryText }, () =>
    queryCurrentPDFBuiltin(queryText),
  );
}
