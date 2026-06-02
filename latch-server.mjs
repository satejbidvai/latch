import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DIR      = new URL('.', import.meta.url);
const TOKEN    = readFileSync(new URL('token', DIR), 'utf8').trim();
// JXA script that calls the private MediaRemote framework directly —
// the same system-level API that Shortcuts' "Play/Pause Media" wraps.
// Command 2 = kMRTogglePlayPause. Works with any app (Music, Spotify, browser, etc.).
// Confirmed working on macOS 15.4+ through macOS 26.2.
const JXA_TOGGLE = `
ObjC.import('Foundation');
const MR = $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/');
MR.load;
const ctrl = $.NSClassFromString('MRNowPlayingController').localRouteController;
ctrl.sendCommandOptionsCompletion(2, $.NSDictionary.alloc.init, null);
delay(0.5);
`;

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  // Header auth. Plain compare is fine for a 128-bit random token.
  if ((req.headers['x-latch-token'] ?? '') !== TOKEN) {
    log(req.method, pathname, 401);
    res.writeHead(401); return res.end();
  }
  if (req.method === 'POST' && pathname === '/playpause') {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA_TOGGLE],
      { timeout: 5000 }, (e) => {
        const code = e ? 500 : 204;
        log(req.method, pathname, code);
        res.writeHead(code); res.end();
      });
    return;
  }
  log(req.method, pathname, 404);
  res.writeHead(404); res.end();
}).listen(8787, '0.0.0.0', () => console.log('Latch ready on :8787'));

// Never log the URL query, headers, or token — method + path + status only.
function log(method, path, status) {
  console.log(`${new Date().toISOString()} ${method} ${path} -> ${status}`);
}
