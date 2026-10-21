# language: Python 3.12, file: api/chat.py, target: Vercel Python runtime
"""POST /api/chat -> SSE stream (single flush on serverless) with refusal retry."""

import json
import urllib.parse
from http.server import BaseHTTPRequestHandler

import core


def _delta(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if urllib.parse.urlparse(self.path).path not in ("/api/chat", "/chat"):
            self._json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 256 * 1024:
            self._json(413, {"error": "Message is too large."})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"error": "Invalid JSON."})
            return

        raw_messages = payload.get("messages")
        if not isinstance(raw_messages, list) or not raw_messages:
            self._json(400, {"error": "messages must be a non-empty array."})
            return

        messages = []
        for item in raw_messages[-core.MAX_MESSAGES:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role not in ("user", "assistant") or not isinstance(content, str):
                continue
            if content.strip():
                messages.append({"role": role, "content": content.strip()})
        messages = core.trim_history(messages)

        if not any(m["role"] == "user" for m in messages):
            self._json(400, {"error": "At least one user message is required."})
            return

        system_prompt = core.load_prompt()
        if system_prompt:
            messages.insert(0, {"role": "system", "content": system_prompt})

        try:
            _reasoning, content = core.answer(messages)
        except Exception as exc:  # noqa: BLE001
            detail = str(exc)
            if detail.startswith(("402:", "429:")):
                self._json(429, {
                    "error": "The free model is busy right now. Wait about 30 seconds, then try again."
                })
            else:
                self._json(502, {"error": f"Model request failed: {detail}"})
            return

        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        # Only the answer channel leaves the server. Private reasoning stays here.
        if content:
            self.wfile.write(_delta({"choices": [{"delta": {"content": content}}]}))
        else:
            self.wfile.write(_delta({"choices": [{"delta": {"content": "The model returned an empty reply."}}]}))
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def _json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return
