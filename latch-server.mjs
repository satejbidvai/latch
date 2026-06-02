import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DIR      = new URL('.', import.meta.url);
const TOKEN    = readFileSync(new URL('token', DIR), 'utf8').trim();
const SHORTCUT = 'Play/Pause Media';   // a saved macOS Shortcut; Apple's own
                                       // entitled Play/Pause action does the work

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  // Header auth. Plain compare is fine for a 128-bit random token.
  if ((req.headers['x-latch-token'] ?? '') !== TOKEN) {
    log(req.method, pathname, 401);
    res.writeHead(401); return res.end();
  }
  if (req.method === 'POST' && pathname === '/playpause') {
    // Fixed argv — the shortcut name is a constant, never request data.
    const child = execFile('/usr/bin/shortcuts', ['run', SHORTCUT],
      { timeout: 10000 }, (e) => {
        const code = e ? 500 : 204;
        log(req.method, pathname, code);
        res.writeHead(code); res.end();
      });
    child.stdin.end();   // `shortcuts run` reads stdin until EOF — close it or it hangs
    return;
  }
  log(req.method, pathname, 404);
  res.writeHead(404); res.end();
}).listen(8787, '0.0.0.0', () => console.log('Latch ready on :8787'));

// Never log the URL query, headers, or token — method + path + status only.
function log(method, path, status) {
  console.log(`${new Date().toISOString()} ${method} ${path} -> ${status}`);
}
