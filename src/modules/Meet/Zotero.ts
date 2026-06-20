import { config } from "../../../package.json";
import { MD5 } from "crypto-js"
import { Document } from "langchain/document";
import { similaritySearch } from "./OpenAI";
import { queryCurrentPDF } from "./PageIndex";
import Meet from "./api";
import ZoteroToolkit from "zotero-plugin-toolkit";

/**
 * 璇诲彇鍓创鏉?
 * @returns string
 */
export function getClipboardText(): string {
  // @ts-ignore
  const clipboardService = window.Cc['@mozilla.org/widget/clipboard;1'].getService(Ci.nsIClipboard);
  // @ts-ignore
  const transferable = window.Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
  if (!transferable) {
    window.alert('鍓创鏉挎湇鍔￠敊璇細鏃犳硶鍒涘缓鍙紶杈撶殑瀹炰緥');
  }
  transferable.addDataFlavor('text/unicode');
  clipboardService.getData(transferable, clipboardService.kGlobalClipboard);
  let clipboardData = {};
  let clipboardLength = {};
  try {
    transferable.getTransferData('text/unicode', clipboardData, clipboardLength);
  } catch (err: any) {
    window.console.error('鍓创鏉挎湇鍔¤幏鍙栧け璐ワ細', err.message);
  }
  // @ts-ignore
  clipboardData = clipboardData.value.QueryInterface(Ci.nsISupportsString);
  // @ts-ignore
  return clipboardData.data
}

/**
 * 灏嗛€変腑鏉＄洰澶勭悊鎴愬叏鏂?
 * 娉ㄦ剰锛氳繖閲岀洰鍓嶆槸涓嶅偍瀛樺緱鍒板悜閲忕殑锛屽洜涓烘潯鐩竴鐩村湪鏇存柊
 * @param key 
 * @returns 
 */
async function selectedItems2documents(key: string) {
  const docs = ZoteroPane.getSelectedItems().map((item: Zotero.Item) => {
    const text = JSON.stringify(item.toJSON());
    return new Document({
      pageContent: text.slice(0, 500),
      metadata: {
        type: "id",
        id: item.id,
        key
      }
    })
  })
  return docs
}

/**
 * https://github.com/MuiseDestiny/zotero-reference/blob/743bef7ac59d644675d8ab33a0b6c138d47fdb2f/src/modules/pdf.ts#L75
 * @param items 
 * @returns 
 */
function mergeSameLine(items: PDFItem[]) {
  let toLine = (item: PDFItem) => {
    let line: PDFLine = {
      x: parseFloat(item.transform[4].toFixed(1)),
      y: parseFloat(item.transform[5].toFixed(1)),
      text: item.str || "",
      height: item.height,
      width: item.width,
      url: item?.url,
      _height: [item.height]
    }
    if (line.width < 0) {
      line.x += line.width
      line.width = -line.width
    }
    return line
  }

  let j = 0
  let lines: PDFLine[] = [toLine(items[j])]
  for (j = 1; j < items.length; j++) {
    let line = toLine(items[j])
    let lastLine = lines.slice(-1)[0]
    // 鑰冭檻涓婃爣涓嬫爣
    if (
      line.y == lastLine.y ||
      (line.y >= lastLine.y && line.y < lastLine.y + lastLine.height) ||
      (line.y + line.height > lastLine.y && line.y + line.height <= lastLine.y + lastLine.height)
    ) {
      lastLine.text += (" " + line.text)
      lastLine.width += line.width
      lastLine.url = lastLine.url || line.url
      // 璁板綍鎵€鏈夐珮搴?
      lastLine._height.push(line.height)
    } else {
      // 澶勭悊宸插畬鎴愮殑琛岋紝鐢ㄤ紬鏁拌祴鍊奸珮搴?
      let hh = lastLine._height
      // lastLine.height = hh.sort((a, b) => a - b)[parseInt(String(hh.length / 2))]
      // 鐢ㄦ渶澶у€?
      // lastLine.height = hh.sort((a, b) => b-a)[0]
      // 浼楁暟
      const num: any = {}
      for (let i = 0; i < hh.length; i++) {
        num[String(hh[i])] ??= 0
        num[String(hh[i])] += 1
      }
      lastLine.height = Number(
        Object.keys(num).sort((h1: string, h2: string) => {
          return num[h2] - num[h1]
        })[0]
      )
      // 鏂扮殑涓€琛?
      lines.push(line)
    }
  }
  return lines
}

declare type Box = {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 鍒ゆ柇A鍜孊涓や釜鐭╁舰鏄惁鍑犱綍鐩镐氦
 * @param A 
 * @param B 
 * @returns 
 */
function isIntersect(A: Box, B: Box): boolean {
  if (
    B.right < A.left ||
    B.left > A.right ||
    B.bottom > A.top ||
    B.top < A.bottom
  ) {
    return false
  } else {
    return true
  }
}

/**
 * 鍒ゆ柇涓よ鏄惁鏄法椤靛悓浣嶇疆琛?
 * @param lineA 
 * @param lineB 
 * @param maxWidth 
 * @param maxHeight 
 * @returns 
 */
function isIntersectLines(lineA: any, lineB: any, maxWidth: number, maxHeight: number) {
  let rectA = {
    left: lineA.x / maxWidth,
    right: (lineA.x + lineA.width) / maxWidth,
    bottom: lineA.y / maxHeight,
    top: (lineA.y + lineA.height) / maxHeight
  }
  let rectB = {
    left: lineB.x / maxWidth,
    right: (lineB.x + lineB.width) / maxWidth,
    bottom: lineB.y / maxHeight,
    top: (lineB.y + lineB.height) / maxHeight
  }
  return isIntersect(rectA, rectB)
}

/**
 * 璇诲彇PDF鍏ㄦ枃锛屽洜涓鸿鍙栭€熷害涓€鑸緝蹇紝鎵€浠ヤ笉鍌ㄥ瓨
 * 褰撶劧鎺掗櫎瀛︿綅璁烘枃锛屼功绫嶇瓑
 * 姝ゅ嚱鏁伴亣鍒皉eference鍏抽敭璇嶄細鍋滄璇诲彇锛屽洜涓哄弬鑰冩枃鐚お褰卞搷鏈€鍚庤绠楃浉浼煎害浜?
 */
async function pdf2documents(itemkey: string) {
  const reader = await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance
  const PDFViewerApplication = (reader._iframeWindow as any).wrappedJSObject.PDFViewerApplication;
  await PDFViewerApplication.pdfLoadingTask.promise;
  await PDFViewerApplication.pdfViewer.pagesPromise;
  let pages = PDFViewerApplication.pdfViewer._pages;
  let totalPageNum = pages.length
  // const popupWin = new ztoolkit.ProgressWindow("[Pending] PDF", { closeTime: -1 })
  //   .createLine({ text: `[1/${totalPageNum}] Reading`, progress: 1, type: "success" })
  //   .show()
  const popupWin = Meet.Global.popupWin.createLine({ text: `[1/${totalPageNum}] Reading PDF`, progress: 1, type: "success" })
    .show()
  // 璇诲彇鎵€鏈夐〉闈ines
  const pageLines: any = {}
  let docs: Document[] = []
  for (let pageNum = 0; pageNum < totalPageNum; pageNum++) {
    let pdfPage = pages[pageNum].pdfPage
    let textContent = await pdfPage.getTextContent()
    let items: PDFItem[] = textContent.items.filter((item: PDFItem) => item.str.trim().length)
    let lines = mergeSameLine(items)
    let index = lines.findIndex(line => /(r?eferences?|acknowledgements)$/i.test(line.text.trim()))
    if (index != -1) {
      lines = lines.slice(0, index)
    }
    pageLines[pageNum] = lines
    popupWin.changeLine({ idx: popupWin.lines.length - 1, text: `[${pageNum + 1}/${totalPageNum}] Reading PDF`, progress: (pageNum + 1) / totalPageNum * 100})
    // 闃叉璇潃
    if (index != -1 && pageNum / totalPageNum >= .9) {
      break
    }
  }
  popupWin.changeLine({ idx: popupWin.lines.length - 1, text: "Reading PDF", progress: 100 })
  popupWin.changeLine({ progress: 100 });
  totalPageNum = Object.keys(pageLines).length
  for (let pageNum = 0; pageNum < totalPageNum; pageNum++) {
    let pdfPage = pages[pageNum].pdfPage
    const maxWidth = pdfPage._pageInfo.view[2];
    const maxHeight = pdfPage._pageInfo.view[3];
    let lines = [...pageLines[pageNum]]
    // 鍘婚櫎椤电湁椤佃剼淇℃伅
    let removeLines = new Set()
    let removeNumber = (text: string) => {
      // 鑻辨枃椤电爜
      if (/^[A-Z]{1,3}$/.test(text)) {
        text = ""
      }
      // 姝ｅ父椤电爜1,2,3
      text = text.replace(/\x20+/g, "").replace(/\d+/g, "")
      return text
    }
    // 鏄惁涓洪噸澶?
    let isRepeat = (line: PDFLine, _line: PDFLine) => {
      let text = removeNumber(line.text)
      let _text = removeNumber(_line.text)
      return text == _text && isIntersectLines(line, _line, maxWidth, maxHeight)
    }
    // 瀛樺湪浜庢暟鎹捣濮嬬粨灏剧殑鏃犳晥琛?
    for (let i of Object.keys(pageLines)) {
      if (Number(i) == pageNum) { continue }
      // 涓や釜涓嶅悓椤碉紝寮€濮嬪姣?
      let _lines = pageLines[i]
      let directions = {
        forward: {
          factor: 1,
          done: false
        },
        backward: {
          factor: -1,
          done: false
        }
      }
      for (let offset = 0; offset < lines.length && offset < _lines.length; offset++) {
        ["forward", "backward"].forEach((direction: string) => {
          if (directions[direction as keyof typeof directions].done) { return }
          let factor = directions[direction as keyof typeof directions].factor
          let index = factor * offset + (factor > 0 ? 0 : -1)
          let line = lines.slice(index)[0]
          let _line = _lines.slice(index)[0]
          if (isRepeat(line, _line)) {
            // 璁や负鏄浉鍚岀殑
            line[direction] = true
            removeLines.add(line)
          } else {
            directions[direction as keyof typeof directions].done = true
          }
        })
      }
      // 鍐呴儴鐨?
      // 璁惧畾涓€涓櫨鍒嗙櫨姝ｆ枃鍖哄煙闃叉璇潃
      const content = { x: 0.2 * maxWidth, width: .6 * maxWidth, y: .2 * maxHeight, height: .6 * maxHeight }
      for (let j = 0; j < lines.length; j++) {
        let line = lines[j]
        if (isIntersectLines(content, line, maxWidth, maxHeight)) { continue }
        for (let k = 0; k < _lines.length; k++) {
          let _line = _lines[k]
          if (isRepeat(line, _line)) {
            line.repeat = line.repeat == undefined ? 1 : (line.repeat + 1)
            line.repateWith = _line
            removeLines.add(line)
          }
        }
      }
    }
    lines = lines.filter((e: any) => !(e.forward || e.backward || (e.repeat && e.repeat > 3)));
    // 娈佃惤鑱氱被
    // 鍘熷垯锛氬瓧浣撲粠澶у埌灏忥紝鍚堝苟锛涗粠灏忓彉澶э紝鏂紑
    let abs = (x: number) => x > 0 ? x : -x
    const paragraphs = [[lines[0]]]
    for (let i = 1; i < lines.length; i++) {
      let lastLine = paragraphs.slice(-1)[0].slice(-1)[0]
      let currentLine = lines[i]
      let nextLine = lines[i + 1]
      const isNewParagraph =
        // 杈惧埌涓€瀹氳鏁伴槇鍊?
        paragraphs.slice(-1)[0].length >= 5 && 
        (
          // 褰撳墠琛屽瓨鍦ㄤ竴涓潪甯稿ぇ鐨勫瓧浣撶殑鏂囧瓧
          currentLine._height.some((h2: number) => lastLine._height.every((h1: number) => h2 > h1)) ||
          // 鏄憳瑕佽嚜鍔ㄤ负涓€娈?
          /abstract/i.test(currentLine.text) ||
          // 涓庝笂涓€琛岄棿璺濊繃澶?
          abs(lastLine.y - currentLine.y) > currentLine.height * 2 ||
          // 棣栬缂╄繘鍒嗘
          (currentLine.x > lastLine.x && nextLine && nextLine.x < currentLine.x)
        )
      // 寮€鏂版钀?
      if (isNewParagraph) {
        paragraphs.push([currentLine])
      }
      // 鍚﹀垯绾冲叆褰撳墠娈佃惤
      else {
        paragraphs.slice(-1)[0].push(currentLine)
      }
    }
    ztoolkit.log(paragraphs)
    // 娈佃惤鍚堝苟
    for (let i = 0; i < paragraphs.length; i++) {
      let box: { page: number, left: number; top: number; right: number; bottom: number }
      /**
       * 鎵€鏈塴ine鏄睘浜庝竴涓钀界殑
       * 鍚堝苟鍚屾椂璁＄畻瀹冪殑杈圭晫
       */
      let _pageText = ""
      let line, nextLine
      for (let j = 0; j < paragraphs[i].length; j++) {
        line = paragraphs[i][j]
        if (!line) { continue }
        nextLine = paragraphs[i]?.[j + 1]
        // 鏇存柊杈圭晫
        box ??= { page: pageNum, left: line.x, right: line.x + line.width, top: line.y + line.height, bottom: line.y }
        if (line.x < box.left) {
          box.left = line.x
        }
        if (line.x + line.width > box.right) {
          box.right = line.x + line.width
        }
        if (line.y < box.bottom) {
          line.y = box.bottom
        }
        if (line.y + line.height > box.top) {
          box.top = line.y + line.height
        }
        _pageText += line.text
        if (
          nextLine &&
          line.height > nextLine.height
        ) {
          _pageText = "\n"
        } else if (j < paragraphs[i].length - 1) {
          if (!line.text.endsWith("-")) {
            _pageText += " "
          }
        }
      }
      _pageText = _pageText.replace(/\x20+/g, " ").replace(/^\x20*\n+/g, "").replace(/\x20*\n+/g, "");
      if (_pageText.length > 0) {
        docs.push(
          new Document({
            pageContent: _pageText,
            metadata: { type: "box", box: box!, key: itemkey },
          })
        )
      }
    }
  }
  // popupWin.changeHeadline("[Done] PDF")
  // popupWin.startCloseTimer(1000)
  console.log("pdf2documents", docs)
  return docs
}

/**
 * 濡傛灉褰撳墠鍦ㄤ富闈㈡澘锛屾牴鎹€変腑鏉＄洰鐢熸垚鏂囨湰锛屾煡鎵剧浉鍏?- 鐢ㄤ簬鎼滅储鏉＄洰
 * 濡傛灉鍦≒DF闃呰鐣岄潰锛岄槄璇籔DF鍘熸枃锛屾煡鎵捐繑鍥炵浉搴旀钀?- 鐢ㄤ簬鎬荤粨闂
 * @param queryText 
 * @returns 
 */
export async function getRelatedText(queryText: string) {
  // @ts-ignore
  const cache = (window._GPTGlobal ??= {cache: []}).cache
  let docs: Document[], key: string
  switch (Zotero_Tabs.selectedIndex) {
    case 0:
      key = MD5(ZoteroPane.getSelectedItems().map(i => i.key).join("")).toString()
      docs = cache[key] || await selectedItems2documents(key)
      cache[key] = docs
      docs = await similaritySearch(queryText, docs, { key }) as Document[]
      ztoolkit.log("docs", docs)
      Zotero[config.addonInstance].views.insertAuxiliary(docs)
      return docs.map((doc: Document, index: number) => `[${index + 1}]${doc.pageContent}`).join("\n\n")
    default:
      const relatedPDF = await queryCurrentPDF(queryText)
      ztoolkit.log("pageindex docs", relatedPDF.docs)
      if (relatedPDF.docs.length) {
        Zotero[config.addonInstance].views.insertAuxiliary(relatedPDF.docs)
      }
      return relatedPDF.text
  }
}
/**
 * 鑾峰彇閫変腑鏉＄洰鏌愪釜瀛楁
 * @param fieldName 
 * @returns 
 */
export function getItemField(fieldName: any) {
  return ZoteroPane.getSelectedItems()[0].getField(fieldName)
}

/**
 * 鑾峰彇PDF椤甸潰鏂囧瓧
 * @returns 
 */
export function getPDFSelection() {
  try {
    return ztoolkit.Reader.getSelectedText(
      Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)
    );
  } catch {
    return ""
  }
}

export async function getPDFAnnotations(select: boolean = false) {
  let keys: string[]
  if (select) {
    // try {
      const reader = await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance
      const nodes = reader._iframeWindow?.document.querySelectorAll("[id^=annotation-].selected") as any
      ztoolkit.log(nodes)
      keys = [...nodes].map(i => i.id.split("-")[1])
      ztoolkit.log(keys)
    // } catch {}
  }
  const pdfItem = Zotero.Items.get(
    Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)!.itemID as number
  )
  const docs: Document[] = [] 
  pdfItem.getAnnotations().forEach((anno: any) => {
    if (select && keys.indexOf(anno.key) == -1) { return }
    const pos = JSON.parse(anno.annotationPosition)
    const rect = pos.rects[0]
    docs.push(
      new Document({
        pageContent: anno.annotationText,
        metadata: {
          type: "box",
          box: { page: pos.pageIndex, left: rect[0], right: rect[2], top: rect[3], bottom: rect[1] },
          key: pdfItem.key
        }
      })
    )
  })
  Zotero[config.addonInstance].views.insertAuxiliary(docs)
  return docs.map((doc: Document, index: number) => `[${index + 1}]${doc.pageContent}`).join("\n\n")
}

