# Zotero PageIndex GPT

[![Using Zotero Plugin Template](https://img.shields.io/badge/Inspired%20by-Zotero%20Plugin%20Template-blue?style=flat-round&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero PageIndex GPT combines the Zotero GPT interaction model with PageIndex
retrieval. PDF question answering no longer uses local vector embeddings for the
current PDF. Instead, Zotero calls a lightweight PageIndex bridge service, and
that service uses a remote OpenAI-compatible API for LLM calls.

## What Changed

- Current PDF retrieval is routed through PageIndex.
- The default chat endpoint is LongCat's OpenAI-compatible API:
  `https://api.longcat.chat/openai`.
- The default model is `LongCat-2.0-Preview`.
- The plugin keeps Zotero UI, command tags, Better Notes integration, selected
  text, annotations, and ordinary chat behavior from Zotero GPT.
- PageIndex runs outside the Zotero plugin process to avoid adding indexing
  load to Zotero itself.

## Build

```powershell
npm install
npm run build
```

The XPI is generated under:

```text
builds/zotero-pageindex-gpt.xpi
```

## How To Use

1. Start Zotero in development mode:

```powershell
npm start
```

2. Open the GPT window from Zotero:

- Menu: `Tools -> Zotero PageIndex GPT`
- Shortcut: `Ctrl + /` on Windows/Linux, `Cmd + /` on macOS

3. Configure the remote model in the GPT input box:

```text
/secretKey your_api_key
/api https://api.longcat.chat/openai
/model LongCat-2.0-Preview
```

4. Ask ordinary questions by typing in the GPT input box and pressing `Enter`.

5. Ask the current PDF:

- Start the PageIndex bridge first.
- Open a PDF in Zotero.
- Open the GPT window.
- Type a question about the PDF, or click the `AskPDF` tag.

## PageIndex Bridge

Use Python 3.10 or newer.

```powershell
pip install -r .\pageindex_service\requirements.txt
$env:LONGCAT_API_KEY = "your_api_key"
npm run pageindex -- --pageindex-repo D:\项目\PageIndex
```

The bridge listens on:

```text
http://127.0.0.1:8765
```

The Zotero preference `extensions.zotero.zoteropageindexgpt.pageIndexServiceUrl`
must match that URL.

## Runtime Settings

In the plugin, configure:

- API URL: `https://api.longcat.chat/openai`
- Model: `LongCat-2.0-Preview`
- API key: your remote API key

Do not commit API keys to this repository.

## Credits

This project is based on ideas and code paths from:

- Zotero Plugin Template: https://github.com/windingwind/zotero-plugin-template
- Zotero GPT: https://github.com/MuiseDestiny/zotero-gpt
- PageIndex: https://github.com/VectifyAI/PageIndex
