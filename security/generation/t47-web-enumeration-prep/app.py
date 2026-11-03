"""Web Enumeration Prep: local HTTP shell and explicitly registered tool modules."""
import argparse
import json
import mimetypes
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from modules import MODULE_TYPES

ROOT = Path(__file__).resolve().parent


class AppServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, data_dir):
        super().__init__(address, Handler)
        self.token = secrets.token_urlsafe(32)
        self.modules = {module.slug: module(data_dir) for module in MODULE_TYPES}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, mime='application/json; charset=utf-8', attachment=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if attachment:
            self.send_header('Content-Disposition', f'attachment; filename="{attachment}"')
        self.end_headers()
        self.wfile.write(body)

    def local_request(self):
        valid = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in valid:
            self.reply(403, {'error': 'Host not allowed.'})
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {'http://' + host for host in valid}:
            self.reply(403, {'error': 'Origin not allowed.'})
            return False
        return True

    def static_file(self, base, relative):
        path = (base / relative).resolve()
        if not path.is_relative_to(base.resolve()) or not path.is_file():
            self.reply(404, {'error': 'File not found.'})
            return
        mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        if path.suffix in ('.css', '.js', '.html'):
            mime = {'.css':'text/css', '.js':'text/javascript', '.html':'text/html'}[path.suffix] + '; charset=utf-8'
        self.reply(200, path.read_bytes(), mime)

    def do_GET(self):
        if not self.local_request():
            return
        route = urlsplit(self.path).path
        try:
            if route == '/api/bootstrap':
                self.reply(200, {'token': self.server.token})
            elif route == '/api/modules':
                self.reply(200, [{'slug':m.slug, 'title':m.title, 'description':m.description,
                                  'cote':m.cote, 'url':f'/tools/{m.slug}/'} for m in self.server.modules.values()])
            elif route.startswith('/api/'):
                _, _, slug, action = route.split('/', 3)
                self.reply(200, self.server.modules[slug].get(action))
            elif route.startswith('/download/'):
                _, _, slug, item_id = route.split('/', 3)
                path, name = self.server.modules[slug].download(item_id)
                self.reply(200, path.read_bytes(), 'text/plain; charset=utf-8', name)
            elif route.startswith('/tools/'):
                _, _, slug, relative = (route.rstrip('/') + '/').split('/', 3)
                self.static_file(self.server.modules[slug].web_root, relative.rstrip('/') or 'index.html')
            elif route.startswith('/assets/'):
                self.static_file(ROOT / 'web' / 'assets', route.removeprefix('/assets/'))
            elif route in ('/', '/home.js', '/shell.css'):
                self.static_file(ROOT / 'web', 'index.html' if route == '/' else route[1:])
            else:
                self.reply(404, {'error': 'Page not found.'})
        except (ValueError, KeyError, TypeError) as exc:
            self.reply(404, {'error': str(exc)})
        except OSError:
            self.reply(500, {'error': 'Unable to read this file.'})

    def do_POST(self):
        if not self.local_request():
            return
        if not secrets.compare_digest(self.headers.get('X-T47-Token', ''), self.server.token):
            self.reply(403, {'error': 'Session expired. Reload the page.'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Request is empty or too large.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Expected a JSON object.')
            route = urlsplit(self.path).path
            if not route.startswith('/api/'):
                self.reply(404, {'error': 'Unknown action.'})
                return
            _, _, slug, action = route.split('/', 3)
            self.reply(200, self.server.modules[slug].post(action, data))
        except KeyError:
            self.reply(404, {'error': 'Unknown module.'})
        except (ValueError, TypeError) as exc:
            self.reply(400, {'error': str(exc)})
        except OSError:
            self.reply(500, {'error': 'Unable to read or write the list directory.'})


def main():
    parser = argparse.ArgumentParser(description='Web Enumeration Prep: local tool workspace')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    server = AppServer(('127.0.0.1', args.port), args.data_dir)
    print(f'Web Enumeration Prep: http://127.0.0.1:{server.server_port} - Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
