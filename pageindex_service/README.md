# PageIndex Bridge Service

This optional service keeps the Python PageIndex backend outside the Zotero
plugin process. The plugin now uses its built-in Zotero/pdf.js parser by default;
run this bridge only when the Zotero preference `pageIndexBackend` is set to
`pageindex-service`.

LLM calls are sent to a remote OpenAI-compatible endpoint. No local LLM endpoint
is required.

## Setup

Use Python 3.9 or newer. When running under Python 3.9, the bridge creates a
temporary compatibility copy of the upstream PageIndex package with postponed
annotations enabled.

Install dependencies:

```powershell
cd <path-to-zotero-pageindex-gpt>
pip install -r .\pageindex_service\requirements.txt
```

Set the remote LLM key. `LONGCAT_API_KEY` is accepted as an alias for
`OPENAI_API_KEY`.

```powershell
$env:LONGCAT_API_KEY = "your_api_key"
```

Defaults:

```text
OPENAI_API_BASE=https://api.longcat.chat/openai
PAGEINDEX_RETRIEVE_MODEL=openai/LongCat-2.0-Preview
PAGEINDEX_INDEX_MODEL=openai/LongCat-2.0-Preview
```

If you use DeepSeek API, override with:

```text
OPENAI_API_BASE=https://api.deepseek.com
OPENAI_API_KEY=<your_deepseek_api_key>
PAGEINDEX_RETRIEVE_MODEL=deepseek-chat
PAGEINDEX_INDEX_MODEL=deepseek-chat
```

## Run

```powershell
npm run pageindex
```

Default bridge URL:

```text
http://127.0.0.1:8765
```

The Zotero preference `extensions.zotero.zoteropageindexgpt.pageIndexServiceUrl`
must match that URL.

## API

- `GET /health`
- `POST /index`
- `GET /status/{zoteroItemKey}`
- `GET /documents/{docId}`
- `GET /documents/{docId}/structure`
- `POST /query`
