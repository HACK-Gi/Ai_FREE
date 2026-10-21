# language: Python 3.12, file: api/health.py, target: Vercel Python runtime
"""GET /api/health -> status pill data for the web UI."""

import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

import core


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path not in ("/api/health", "/health"):
            self._json(404, {"error": "not found"})
            return

        info = {
            "app": "deepseek-mix",
            "ok": False,
            "model": core.MODEL,
            "base": urllib.parse.urlparse(core.BASE_URL).netloc,
        }
        headers = {"User-Agent": "deepseek-mix-vercel/1.0"}
        if core.API_KEY:
            headers["Authorization"] = f"Bearer {core.API_KEY}"
        try:
            req = urllib.request.Request(f"{core.BASE_URL}/models", headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
            models = [str(item.get("id")) for item in data.get("data", []) if isinstance(item, dict) and item.get("id")]
            info.update(ok=True, model=core.MODEL if core.MODEL not in ("", "local", "local-model", "auto") else (models[0] if models else core.MODEL), models=models[:20])
        except Exception as exc:  # show the real reason
            info["error"] = str(exc)[:300]
        self._json(200, info)

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
