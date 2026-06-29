# Zotero PageIndex GPT

[![Using Zotero Plugin Template](https://img.shields.io/badge/Inspired%20by-Zotero%20Plugin%20Template-blue?style=flat-round&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero PageIndex GPT combines the Zotero GPT interaction model with a
PageIndex-style PDF retrieval flow. PDF question answering uses Zotero's built-in
PDF reader text layer by default, so users do not need to install Python or start
an external service for ordinary AskPDF usage.

## What Changed

- Current PDF retrieval is routed through PageIndex.
- The default PageIndex backend is built into the Zotero plugin and uses
  Zotero/pdf.js to extract PDF text.
- The default chat endpoint is LongCat's OpenAI-compatible API:
  `https://api.longcat.chat/openai`.
- The default model is `LongCat-2.0-Preview`.
- Optional DeepSeek preset is available (`/apiProvider deepseek`), using
  `https://api.deepseek.com` and `deepseek-chat`.
- The preferences pane includes an API configuration dropdown. Use
  `Add Configuration` to save additional API URL, key, and model combinations.
- The plugin keeps Zotero UI, command tags, Better Notes integration, selected
  text, annotations, and ordinary chat behavior from Zotero GPT.
- The optional Python PageIndex bridge remains available as an advanced backend.

## Install (Users)

Install from a release XPI (recommended for normal users):

1. Download the latest `zotero-pageindex-gpt.xpi` from
   [Releases](https://github.com/huangfu170/zotero-pageindex-gpt/releases/latest).
2. In Zotero: `Tools -> Add-ons`.
3. Click the gear icon and choose `Install Add-on From File...`.
4. Select `zotero-pageindex-gpt.xpi`.

After installation, restart Zotero when prompted.

## How To Use

1. Open the GPT window from Zotero:

- Menu: `Tools -> Zotero PageIndex GPT`
- Shortcut: `Ctrl + /` on Windows/Linux, `Cmd + /` on macOS

2. Configure the remote model in the GPT input box:

```text
/apiProvider deepseek
/secretKey your_api_key
/api https://api.longcat.chat/openai
/api https://api.deepseek.com
/model LongCat-2.0-Preview
```

You can also open the plugin preferences, choose an existing API configuration
from the dropdown, or click `Add Configuration` to add a new URL/key/model
combination to the dropdown.

3. Ask ordinary questions by typing in the GPT input box and pressing `Enter`.

4. Ask the current PDF:

- Open a PDF in Zotero.
- Open the GPT window.
- Type a question about the PDF, or click the `AskPDF` tag.

## Build and Local Run (Developers)

```powershell
npm install
npm run build
```

The XPI is generated under:

```text
builds/zotero-pageindex-gpt.xpi
```

Start Zotero in development mode:

```powershell
npm start
```

This builds the plugin, writes a development extension proxy into the profile
configured by `.env`, and starts Zotero with that profile.

### Local development key (optional)

For local development only, add your key to `.env`:

```text
ZOTERO_PLUGIN_LONGCAT_SECRET_KEY=your_api_key
```

`scripts/install-dev.js` reads this value when running `npm start` and writes it as
`extensions.zotero.zoteropageindexgpt.secretKey` into the development profile.
It is still committed as an empty default key in source.

## Optional PageIndex Bridge

The default backend is built into the plugin. Use the Python bridge only if you
want to compare against the upstream PageIndex service backend.

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

Set the Zotero preference `extensions.zotero.zoteropageindexgpt.pageIndexBackend`
to `pageindex-service`. The preference
`extensions.zotero.zoteropageindexgpt.pageIndexServiceUrl` must match the bridge
URL.

## Runtime Settings

In the plugin, configure:

- API URL: `https://api.longcat.chat/openai`
- Model: `LongCat-2.0-Preview`
- API key: your remote API key
- API configuration: choose `LongCat`, `DeepSeek`, or add a custom URL/key/model
  combination in preferences.
- PageIndex backend: `builtin` by default, or `pageindex-service` for the
  optional Python bridge.
- DeepSeek preset:
  - `/apiProvider deepseek`
  - `/api https://api.deepseek.com`
  - `/model deepseek-chat`

Do not commit API keys to this repository.

## Credits

This project is based on ideas and code paths from:

- Zotero Plugin Template: https://github.com/windingwind/zotero-plugin-template
- Zotero GPT: https://github.com/MuiseDestiny/zotero-gpt
- PageIndex: https://github.com/VectifyAI/PageIndex
