#!/usr/bin/env python3
"""Static dev server that never lets the browser cache a module.

python -m http.server serves Last-Modified only, and browsers happily keep ES
modules in the HTTP cache across reloads, so an edited src/ui/*.js keeps
running the previous build. This serves the same tree with no-store.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s\n' % (fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(('127.0.0.1', port), partial(NoCacheHandler)).serve_forever()
