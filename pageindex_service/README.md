# PageIndex Bridge Service

This service keeps PageIndex work outside the Zotero plugin process. Zotero sends
the current PDF path to this localhost bridge, and the bridge builds or reuses a
PageIndex tree and returns page-level context.

LLM calls are sent to a remote OpenAI-compatible endpoint. No local LLM endpoint
is required.

## Setup

Use Python 3.10 or newer. The upstream PageIndex code uses Python 3.10 type
syntax and will not import under Python 3.9.

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

## Run

```powershell
python .\pageindex_service\server.py --pageindex-repo <path-to-PageIndex>
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
