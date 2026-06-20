from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_PAGEINDEX_REPO = r"D:\项目\PageIndex"
DEFAULT_REMOTE_API_BASE = "https://api.longcat.chat/openai"
DEFAULT_REMOTE_MODEL = "openai/LongCat-2.0-Preview"
MAP_FILE = "zotero_map.json"


def add_pageindex_to_path(repo: str) -> None:
    if sys.version_info < (3, 10):
        raise RuntimeError("PageIndex requires Python 3.10 or newer.")
    repo_path = Path(repo).expanduser().resolve()
    if not repo_path.exists():
        raise FileNotFoundError(f"PageIndex repo not found: {repo_path}")
    sys.path.insert(0, str(repo_path))


class JsonStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        with self.lock:
            if not self.path.exists():
                return {}
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return {}

    def save(self, data: dict[str, Any]) -> None:
        with self.lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self.path)


class PageIndexService:
    def __init__(self, pageindex_repo: str, workspace: str, model: str | None = None):
        os.environ.setdefault("OPENAI_API_BASE", DEFAULT_REMOTE_API_BASE)
        os.environ.setdefault("OPENAI_BASE_URL", DEFAULT_REMOTE_API_BASE)
        os.environ.setdefault("PAGEINDEX_RETRIEVE_MODEL", DEFAULT_REMOTE_MODEL)
        if os.getenv("LONGCAT_API_KEY") and not os.getenv("OPENAI_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.getenv("LONGCAT_API_KEY", "")
        add_pageindex_to_path(pageindex_repo)
        from pageindex import PageIndexClient

        self.workspace = Path(workspace).expanduser().resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.client = PageIndexClient(
            workspace=str(self.workspace),
            model=model or DEFAULT_REMOTE_MODEL,
            retrieve_model=os.getenv("PAGEINDEX_RETRIEVE_MODEL", DEFAULT_REMOTE_MODEL),
        )
        self.map_store = JsonStore(self.workspace / MAP_FILE)
        self.jobs: dict[str, dict[str, Any]] = {}
        self.jobs_lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1)

    @staticmethod
    def _file_fingerprint(pdf_path: str) -> dict[str, Any]:
        path = Path(pdf_path).expanduser().resolve()
        stat = path.stat()
        return {
            "path": str(path),
            "mtime": stat.st_mtime,
            "size": stat.st_size,
        }

    @staticmethod
    def _identity(payload: dict[str, Any], fingerprint: dict[str, Any]) -> str:
        raw = "|".join(
            [
                str(payload.get("zoteroItemKey") or ""),
                str(payload.get("attachmentKey") or ""),
                fingerprint["path"],
            ]
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "version": "pageindex-zotero-remote-llm-0.1",
            "api_base": os.getenv("OPENAI_API_BASE"),
            "workspace": str(self.workspace),
            "documents": len(self.client.documents),
        }

    def index(self, payload: dict[str, Any]) -> dict[str, Any]:
        pdf_path = payload.get("pdfPath")
        if not pdf_path:
            return {"status": "failed", "error": "pdfPath is required"}
        if not str(pdf_path).lower().endswith(".pdf"):
            return {"status": "failed", "error": "Only PDF attachments are supported"}

        try:
            fingerprint = self._file_fingerprint(str(pdf_path))
        except OSError as exc:
            return {"status": "failed", "error": f"Cannot stat PDF: {exc}"}

        identity = self._identity(payload, fingerprint)
        zotero_key = payload.get("zoteroItemKey") or payload.get("attachmentKey") or identity
        mapping = self.map_store.load()
        cached = mapping.get(identity)
        if cached and cached.get("fingerprint") == fingerprint:
            doc_id = cached.get("docId")
            if doc_id in self.client.documents:
                return {"status": "completed", "docId": doc_id}

        with self.jobs_lock:
            job = self.jobs.get(identity)
            if job:
                return {
                    "status": job["status"],
                    "docId": job.get("docId"),
                    "message": job.get("message"),
                    "error": job.get("error"),
                }
            self.jobs[identity] = {
                "status": "queued",
                "zoteroItemKey": zotero_key,
                "fingerprint": fingerprint,
            }

        self.executor.submit(self._run_index_job, identity, fingerprint)
        return {
            "status": "queued",
            "message": "PageIndex indexing job queued. Ask again after it finishes.",
        }

    def _run_index_job(self, identity: str, fingerprint: dict[str, Any]) -> None:
        with self.jobs_lock:
            self.jobs[identity]["status"] = "indexing"
            self.jobs[identity]["message"] = "Building PageIndex tree."
        try:
            doc_id = self.client.index(fingerprint["path"])
            mapping = self.map_store.load()
            mapping[identity] = {
                "docId": doc_id,
                "fingerprint": fingerprint,
            }
            self.map_store.save(mapping)
            with self.jobs_lock:
                self.jobs[identity].update(
                    {
                        "status": "completed",
                        "docId": doc_id,
                        "message": "Indexing completed.",
                    }
                )
        except Exception as exc:
            with self.jobs_lock:
                self.jobs[identity].update(
                    {
                        "status": "failed",
                        "error": f"{exc}",
                        "traceback": traceback.format_exc(),
                    }
                )

    def status(self, zotero_key: str) -> dict[str, Any]:
        with self.jobs_lock:
            for job in self.jobs.values():
                if job.get("zoteroItemKey") == zotero_key:
                    return dict(job)
        mapping = self.map_store.load()
        for entry in mapping.values():
            doc_id = entry.get("docId")
            if doc_id in self.client.documents:
                return {"status": "completed", "docId": doc_id}
        return {"status": "queued", "message": "No active or cached index found."}

    def document(self, doc_id: str) -> dict[str, Any]:
        return json.loads(self.client.get_document(doc_id))

    def structure(self, doc_id: str) -> Any:
        return json.loads(self.client.get_document_structure(doc_id))

    def query(self, payload: dict[str, Any]) -> dict[str, Any]:
        doc_id = payload.get("docId")
        question = payload.get("question")
        if not doc_id or not question:
            return {"error": "docId and question are required", "contexts": []}
        if doc_id not in self.client.documents:
            return {"error": f"Document {doc_id} not found", "contexts": []}

        max_pages = int(payload.get("maxPages") or 5)
        structure = self.client.get_document_structure(doc_id)
        pages, trace = self._select_pages(doc_id, question, structure, max_pages)
        page_content = json.loads(self.client.get_page_content(doc_id, pages))
        if isinstance(page_content, dict) and page_content.get("error"):
            return {"error": page_content["error"], "contexts": []}
        return {
            "docId": doc_id,
            "pages": pages,
            "trace": trace,
            "contexts": page_content,
        }

    def _select_pages(self, doc_id: str, question: str, structure: str, max_pages: int) -> tuple[str, str]:
        try:
            from litellm import completion

            prompt = (
                "You select tight PDF page ranges for retrieval.\n"
                "Return JSON only, shaped as {\"pages\":\"5-7\",\"reason\":\"...\"}.\n"
                f"Use at most {max_pages} pages. Do not fetch the full document.\n\n"
                f"Question:\n{question}\n\nDocument tree:\n{structure[:60000]}"
            )
            response = completion(
                model=os.getenv("PAGEINDEX_RETRIEVE_MODEL", DEFAULT_REMOTE_MODEL),
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
            )
            content = response.choices[0].message.content or ""
            parsed = self._parse_page_selection(content)
            if parsed:
                return parsed["pages"], parsed.get("reason", "")
        except Exception as exc:
            fallback, reason = self._fallback_pages(doc_id, max_pages)
            return fallback, f"LLM page selection failed; fallback used: {exc}. {reason}"

        fallback, reason = self._fallback_pages(doc_id, max_pages)
        return fallback, f"Could not parse LLM page selection. {reason}"

    @staticmethod
    def _parse_page_selection(content: str) -> dict[str, str] | None:
        match = re.search(r"\{.*\}", content, re.S)
        if not match:
            return None
        data = json.loads(match.group(0))
        pages = str(data.get("pages") or "").strip()
        if not re.fullmatch(r"\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*", pages):
            return None
        return {"pages": pages.replace(" ", ""), "reason": str(data.get("reason") or "")}

    def _fallback_pages(self, doc_id: str, max_pages: int) -> tuple[str, str]:
        meta = json.loads(self.client.get_document(doc_id))
        page_count = int(meta.get("page_count") or 1)
        end = max(1, min(page_count, max_pages))
        return f"1-{end}" if end > 1 else "1", "Using the first pages as a conservative fallback."


def make_handler(service: PageIndexService):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("[pageindex-service] " + fmt % args + "\n")

        def _json(self, status: int, payload: Any) -> None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length == 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def do_GET(self) -> None:
            try:
                parsed = urlparse(self.path)
                path = unquote(parsed.path)
                if path == "/health":
                    self._json(HTTPStatus.OK, service.health())
                    return
                if path.startswith("/status/"):
                    self._json(HTTPStatus.OK, service.status(path.split("/", 2)[2]))
                    return
                match = re.fullmatch(r"/documents/([^/]+)", path)
                if match:
                    self._json(HTTPStatus.OK, service.document(match.group(1)))
                    return
                match = re.fullmatch(r"/documents/([^/]+)/structure", path)
                if match:
                    self._json(HTTPStatus.OK, service.structure(match.group(1)))
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": f"Unknown endpoint: {path}"})
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

        def do_POST(self) -> None:
            try:
                parsed = urlparse(self.path)
                path = unquote(parsed.path)
                payload = self._read_json()
                if path == "/index":
                    self._json(HTTPStatus.OK, service.index(payload))
                    return
                if path == "/query":
                    self._json(HTTPStatus.OK, service.query(payload))
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": f"Unknown endpoint: {path}"})
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="PageIndex bridge service for Zotero GPT.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--pageindex-repo", default=os.getenv("PAGEINDEX_REPO", DEFAULT_PAGEINDEX_REPO))
    parser.add_argument(
        "--workspace",
        default=os.getenv("PAGEINDEX_WORKSPACE", str(Path.home() / ".zotero-gpt-pageindex")),
    )
    parser.add_argument("--model", default=os.getenv("PAGEINDEX_INDEX_MODEL"))
    args = parser.parse_args()

    service = PageIndexService(
        pageindex_repo=args.pageindex_repo,
        workspace=args.workspace,
        model=args.model,
    )
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    print(f"PageIndex service listening on http://{args.host}:{args.port}")
    print(f"Workspace: {args.workspace}")
    server.serve_forever()


if __name__ == "__main__":
    main()
