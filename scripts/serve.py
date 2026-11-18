#!/usr/bin/env python3
"""Local server with Netlify-style pretty URLs and the 301s from data/redirects.json.

    python3 scripts/serve.py [port]     # default 8930
"""
import http.server, json, os, socketserver, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8930


def redirects():
    p = os.path.join(ROOT, 'data', 'redirects-all.json')   # written by build.py, same list as netlify.toml
    return json.load(open(p)) if os.path.exists(p) else []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        for r in redirects():
            if path == r["from"] or path.rstrip("/") == r["from"].rstrip("/"):
                self.send_response(301); self.send_header('Location', r['to']); self.end_headers(); return
        if not os.path.splitext(path)[1] and path != '/':
            if os.path.exists(os.path.join(ROOT, path.strip('/') + '.html')):
                self.path = path.rstrip('/') + '.html'
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_error(self, code, *a, **kw):
        if code == 404:
            body = open(os.path.join(ROOT, '404.html'), 'rb').read()
            self.send_response(404); self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().send_error(code, *a, **kw)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'http://localhost:{PORT}')
    httpd.serve_forever()
