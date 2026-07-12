#!/usr/bin/env python3
"""开发用反向代理:静态文件从 app/web 读,/api/* 转发到本地后端(8898)。
供 preview 沙箱使用——preview 跑不了 uvicorn,但能跑这个标准库代理。
"""
import http.server
import socketserver
import http.client
import sys

WEB_DIR = '/Users/wupeng/Desktop/code/my-first-eval/server/app/web'
BACKEND_HOST = '127.0.0.1'
BACKEND_PORT = 8898
PORT = 8899
HOP_BY_HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
              'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-length', 'host'}


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=WEB_DIR, **k)

    def _proxy(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        body = self.rfile.read(length) if length else None
        fwd_headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        conn = http.client.HTTPConnection(BACKEND_HOST, BACKEND_PORT, timeout=600)
        try:
            conn.request(self.command, self.path, body=body, headers=fwd_headers)
            resp = conn.getresponse()
            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                if k.lower() in HOP_BY_HOP:
                    continue
                self.send_header(k, v)
            self.end_headers()
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except Exception as e:
            try:
                self.send_response(502)
                self.end_headers()
                self.wfile.write(('proxy error: ' + str(e)).encode())
            except Exception:
                pass
        finally:
            conn.close()

    def _is_api(self):
        return self.path.startswith('/api/')

    def do_GET(self):
        self._proxy() if self._is_api() else super().do_GET()

    def do_POST(self):
        self._proxy() if self._is_api() else self.send_error(405)

    def do_PUT(self):
        self._proxy() if self._is_api() else self.send_error(405)

    def do_DELETE(self):
        self._proxy() if self._is_api() else self.send_error(405)

    def do_PATCH(self):
        self._proxy() if self._is_api() else self.send_error(405)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('0.0.0.0', PORT), ProxyHandler) as httpd:
        print(f'[dev_proxy] {WEB_DIR}  +  /api → {BACKEND_HOST}:{BACKEND_PORT}  on :{PORT}', flush=True)
        sys.stdout.flush()
        httpd.serve_forever()
