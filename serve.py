#!/usr/bin/env python3
"""Serve the Operator Tracker locally:  python3 serve.py [port]"""

import http.server
import os
import sys
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # data is rebuilt often
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    if not (ROOT / "data" / "index.json").exists():
        print("No data yet. Run:  python3 etl/build.py   (and python3 etl/fetch_maps.py for minimaps)")
    url = f"http://localhost:{port}/web/"
    # Local only: the data is licensed and must not be exposed to the network.
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"Operator Tracker at {url}  (Ctrl+C to stop)")
    if not os.environ.get("NO_BROWSER"):
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
