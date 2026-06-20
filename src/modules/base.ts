import { config } from "../../package.json";


const help = `
### Quick Commands

\`/help\` Show all commands.
\`/clear\` Clear history conversation.
\`/report\` Run this and copy the output content to give feedback to the developer.
\`/secretKey ak-xxx\` Set remote API key.
\`/api https://api.longcat.chat/openai\` Set an OpenAI-compatible remote API.
\`/model LongCat-2.0-Preview\` Set the remote model.
\`/temperature 1.0\` Set GPT temperature. Controls the randomness and diversity of generated text, specified within a range of 0 to 1.
\`/chatNumber 3\` Set the number of saved historical conversations.
\`/relatedNumber 5\` Set the number of most relevant text. For example, the number of paragraphs referenced while using askPDF.
\`/deltaTime 100\` Control GPT smoothness (ms).
\`/width 32%\` Control GPT UI width (pct).
\`/tagsMore expand/scroll\` Set mode to display more tags.
\`/key default\` Restore the variable values above to their default values (if have).

### About UI

You can hold down \`Ctrl\` and scroll the mouse wheel to zoom the entire UI.
And when your mouse is in the output box, the size of any content in the output box will be adjusted.

### About Tag

You can \`long click\` on the tag below to see its internal pseudo-code.
You can type \`#xxx\` and press \`Enter\` to create a tag. And save it with \`Ctrl + S\`, during which you can execute it with \`Ctrl + R\`.
You can \`right-long-click\` a tag to delete it.

### About Output Text

You can \`double click\` on this text to copy GPT's answer.
You can \`long press\` me without releasing, then move me to a suitable position before releasing.

### About Input Text

You can exit me by pressing \`Esc\` above my head and wake me up by pressing \`Shift + /\` or \`Shift + ?\` in the Zotero main window.
You can type the question in my header, then press \`Enter\` to ask me.
You can press \`Ctrl + Enter\` to execute last executed command tag again.
You can press \`Shift + Enter\` to enter long text editing mode and press \`Ctrl + R\` to execute long text.
`
// 杩欐槸 OpenAI ChatGPT 鐨勫瓧浣?
const fontFamily = `S枚hne,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif,Helvetica Neue,Arial,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji`

function parseTag(text: string) {
  text = text.replace(/^\n/, "").replace(/\n$/, "")
  let tagString = text.match(/^#(.+)\n/) as any
  function randomColor() {
    var letters = '0123456789ABCDEF';
    var color = '#';
    for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }
  let tag: Tag = {
    tag: config.addonName,
    color: randomColor(),
    position: 9,
    text: text,
    trigger: "",
  }
  if (tagString) {
    tagString = tagString[0]
    tag.tag = tagString.match(/^#([^\[\n]+)/)[1]
    // 瑙ｆ瀽棰滆壊
    let color = tagString.match(/\[c(?:olor)?="?(#.+?)"?\]/)
    tag.color = color?.[1] || tag.color
    // 瑙ｆ瀽浣嶇疆
    let position = tagString.match(/\[pos(?:ition)?="?(\d+?)"?\]/)
    tag.position = Number(position?.[1] || tag.position)
    // 瑙ｆ瀽鍏抽敭璇?
    let trigger = tagString.match(/\[tr(?:igger)?="?(.+)"?\]/)
    tag.trigger = trigger?.[1] || tag.trigger
    tag.text = `#${tag.tag}[position=${tag.position}][color=${tag.color}][trigger=${tag.trigger}]` + "\n" + text.replace(/^#.+\n/, "")
  }
  return tag
}

/**
 * 杩欓噷榛樿鏍囩鏃犳硶鍒犻櫎锛屼絾鍙互鏇存敼閲岄潰鐨勫唴瀹癸紝姣斿棰滆壊浣嶇疆锛屽唴閮╬rompt
 */
let defaultTags: any = [
`
#馃獝AskPDF[color=#0EA293][position=10][trigger=/^(鏈枃|杩欑瘒鏂囩珷|璁烘枃)/]
You are a helpful assistant. Context information is below.
$\{
Meet.Global.views.messages = [];
Meet.Zotero.getRelatedText(Meet.Global.input)
\}
Using the provided context information, write a comprehensive reply to the given query. Make sure to cite results using [number] notation after the reference. If the provided context information refer to multiple subjects with the same name, write separate answers for each subject. Use prior knowledge only if the given context didn't provide enough information.

Answer the question: $\{Meet.Global.input\}

Reply in ${Zotero.locale}
`,
`
#馃専Translate[c=#D14D72][pos=11][trigger=/^缈昏瘧/]
Translate these content to 绠€浣撲腑鏂?
$\{
Meet.Global.input.replace("缈昏瘧", "") ||
Meet.Zotero.getPDFSelection() ||
Meet.Global.views.messages[0].content
\}

`,
`
#鉁↖mprove writing[color=#8e44ad][pos=12][trigger=/^娑﹁壊/]
Below is a paragraph from an academic paper. Polish the writing to meet the academic style, improve the spelling, grammar, clarity, concision and overall readability. When necessary, rewrite the whole sentence. Furthermore, list all modification and explain the reasons to do so in markdown table. Paragraph: "$\{
Meet.Global.input.replace("娑﹁壊", "") ||
Meet.Global.views.messages[0].content
\}"
`,
`
#Clipboard[c=#576CBC][pos=13][trigger=/(鍓创鏉縷澶嶅埗鍐呭)/]
This is the content in my clipboard:
$\{Meet.Zotero.getClipboardText()\}
---
$\{Meet.Global.input\}
`,
`
#Annotations[c=#F49D1A][pos=14][trigger=/(閫変腑|閫夋嫨鐨剕閫夋嫨|鎵€閫??(娉ㄩ噴|楂樹寒|鏍囨敞)/]
These are PDF Annotation contents:
$\{
Meet.Zotero.getPDFAnnotations(Meet.Global.input.match(/(閫変腑|閫夋嫨鐨剕閫夋嫨|鎵€閫?/))
\}

Please answer me in the language of my question. Make sure to cite results using [number] notation after the reference. 
My question is: $\{Meet.Global.input\}
`,
`
#Selection[c=#D14D72][pos=15][trigger=/^(杩欐|閫変腑)(鏂囨湰|璇潀鏂囧瓧|鎻忚堪)/]
Read these content:
$\{
Meet.Zotero.getPDFSelection() ||
Meet.Global.views.messages[0].content
\}
---
Answer me in the language of my question. This is my question: $\{Meet.Global.input\}
`,
  `
#Item[c=#159895][pos=16][trigger=/杩欑瘒(鏂囩尞|璁烘枃|鏂囩珷)/]
This is a Zotero item presented in JSON format:
$\{
JSON.stringify(ZoteroPane.getSelectedItems()[0].toJSON())
\}

Base on this JSON: $\{Meet.Global.input\}
`,
  `
#Items[c=#159895][pos=17][trigger=/杩欎簺(鏂囩尞|璁烘枃)/]
These are Zotero items presented in JSON format:
$\{
Meet.Zotero.getRelatedText(Meet.Global.input)
\}

Please answer me using the lanaguage as same as my question. Make sure to cite results using [number] notation after the reference. 
My question is: $\{Meet.Global.input\}
`,
]
defaultTags = defaultTags.map(parseTag)


export { help, fontFamily, defaultTags, parseTag }

