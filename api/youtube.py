from http.server import BaseHTTPRequestHandler
import json

class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        self.send_json({
            'success': False,
            'error': 'YouTube 解析已改為前端直連 VPS。請更新前端程式碼。',
            'fallback': 'http://108.61.163.87:8799/api/yt-dlp'
        })

    def do_GET(self):
        self.send_error(405, '只接受 POST 請求')

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error(self, code, message):
        self.send_json({'success': False, 'error': message}, code)
