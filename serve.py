#!/usr/bin/env python3
"""Static dev server. Sends no-store so edited modules are never served from cache."""

import os
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
    # Serve this file's own directory, so the launcher's cwd never matters.
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(NoCacheHandler, directory=root)
    print(f"Serving {root} on http://127.0.0.1:{port}")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
