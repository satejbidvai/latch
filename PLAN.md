# Latch — implementation plan

A one-button remote that toggles play/pause on this Mac from an iPhone Shortcut.
The phone sends a **header-authenticated** POST over the **trusted local network**;
a tiny Node server runs a compiled Swift helper that posts the system Play/Pause
media key, which macOS routes to whatever owns the now-playing session (Music,
Spotify, browser video, podcasts).

> Vocabulary is defined in [`CONTEXT.md`](./CONTEXT.md). The "Decisions reached"
> table below records *why* each choice was made, so they don't get re-litigated.

---

## ⚠️ Build amendment (2026-06-02): the media-key approach was abandoned

The plan below specifies a compiled Swift **Helper** (`playpause`) that posts a
synthetic `NX_KEYTYPE_PLAY` media key, gated behind an Accessibility grant. **On
macOS 26 this does not work**, and was replaced during the build. What we found,
in order:

1. **Synthetic media key (`NSEvent.systemDefined`, all three event taps):** posts
   cleanly (`nilEvents=0`) from a process confirmed `AXIsProcessTrusted() == true`
   — yet the now-playing system ignores it. macOS 26 no longer honors synthetic
   media events from unentitled processes. (We *did* solve the launchd TCC
   attribution problem along the way: a `responsibility_spawnattrs_setdisclaim`
   re-exec made the Helper judged on its own grant instead of node's — kept node
   untrusted. That work was discarded with the Helper.)
2. **`MRMediaRemoteSendCommand(kMRTogglePlayPause)`:** resolves and returns
   `true`, but is a silent no-op — entitlement-gated (`com.apple.mediaremote.
   send-command`) since macOS 15.4, and that entitlement is Apple-only.
3. **✅ Adopted — Apple's Play/Pause Shortcuts action:** the Server now runs
   `shortcuts run "Play/Pause Media"` (a saved **Mac Shortcut**). It's first-party
   and properly entitled, so it toggles generically — **including browser video**,
   the user's primary case. **No Accessibility grant, no Swift, no TCC.** One
   wrinkle: `shortcuts run` reads stdin until EOF, so the Server closes the
   child's stdin or it hangs forever (also sets a 10 s `execFile` timeout).

**Net effect on the plan below:** Task 1 (Swift helper), the Accessibility manual
step, the grant-fragility decisions, and the media-key gotcha are **superseded**.
The Server, Token, LaunchAgent, doctor, auth model, and all security invariants
stand unchanged — only *what the one route runs* changed. `README.md` and
`CONTEXT.md` describe the shipped system.

---

## Architecture (context)

- **iPhone side:** a single Shortcut (built manually by the user, not by you). It
  issues one **Trigger**: `Get Contents of URL`, POST, to `/playpause`, carrying
  the **Token** in an `X-Latch-Token` request header.
- **Mac side (what you build):**
  - `playpause` — a compiled Swift binary (the **Helper**) that posts
    `NX_KEYTYPE_PLAY`.
  - `latch-server.mjs` — a zero-dependency Node stdlib HTTP server (the
    **Server**) with exactly one endpoint, gated by a header token, bound to the
    LAN.
  - `latch-doctor.sh` — a diagnostic script for silent failures.
  - a `token` file, and a LaunchAgent to start the Server at login.

The Mac listener is irreducible: nothing lets the phone execute on the Mac
without something listening. Keep it minimal.

---

## Decisions reached (the "why")

| Area | Decision |
|---|---|
| **Threat model** | Home/**trusted LAN only**. Plain HTTP + bind to `0.0.0.0` accepted. The Server is **not** safe on untrusted Wi-Fi — unload the LaunchAgent when roaming. |
| **Auth** | Keep the gate. The real threat is **browser drive-by/CSRF** (any website can `fetch` a local URL), not LAN neighbors — so even a play/pause toggle earns a token. Secret travels in an `X-Latch-Token` header; compared with a plain `!==` (a 128-bit random token makes timing attacks irrelevant, so no `crypto` needed). |
| **Stack** | Node 26 stdlib server + Swift helper. **No Bun, no build step** — speed is a non-factor at this volume; the value is "still runs untouched in two years". |
| **Startup / TCC** | LaunchAgent autostart. Grant Accessibility to `playpause` **first**; only add a `node` grant if that genuinely fails under `launchd`. Use the stable `/opt/homebrew/bin/node` symlink in the plist (never the versioned Cellar path). |
| **Grant fragility** | Recompiling `playpause` **or** `brew upgrade node` can silently void the Accessibility grant → documented re-grant step. This is the #1 maintenance landmine. |
| **Repo** | `~/Work/Personal/latch` is a **single git repo = source + runtime**. No separate `~/latch`, no deploy step. `.gitignore` excludes `token`, the compiled `playpause`, and logs. |
| **Action** | Blind **Toggle**, single route `POST /playpause`. No directed play/pause (would require a now-playing-state dependency). |
| **Observability** | `latch-doctor.sh` + `StandardErrorPath`/`StandardOutPath` in the plist. **The Server must never log the request URL, headers, or token** — method + path + status only. |
| **Recovery** | Documented token-rotation procedure as the leak/compromise valve. |

---

## Security invariants (must hold)

1. Every request is rejected with `401` unless its `X-Latch-Token` header matches
   the Token exactly.
2. The Server binds to the LAN port only. **Do not** add public exposure, tunnels,
   port forwarding, ngrok, or any cloud relay. Accept that `0.0.0.0` means the
   Server is unsafe on untrusted networks — that risk is managed operationally
   (unload the agent when roaming), not in code.
3. There is exactly one route: `POST /playpause` → runs the fixed `playpause`
   binary with **no arguments**. **Never** interpolate any request data into a
   command, path, or argument.
4. **Zero runtime dependencies.** Node standard library only. No Express, no npm
   packages, no build step, no Bun.
5. **Do not** add SSH / Remote Login based mechanisms.
6. **Do not** broaden the action set beyond `/playpause`. More actions, if wanted,
   are added explicitly — and because the gate already exists, they land
   authenticated by default.
7. **Never log the request URL, headers, or token.** Logs carry method + path +
   status only, so the secret never lands in `latch.log`.

---

## Preflight checks

Run these first; if any fail, stop and report:

- `sw_vers` — confirm macOS. (Verified: macOS 26.5.)
- `node --version` — require Node 18+. (Verified: v26.0.0 at `/opt/homebrew/bin/node`.)
- `swiftc --version` — if missing, instruct: `xcode-select --install`. (Verified:
  `/usr/bin/swiftc`.)

The project directory is `~/Work/Personal/latch` (this repo). All files live here.

---

## Task 0 — Initialize the repo

```
cd ~/Work/Personal/latch
git init
printf '%s\n' token playpause '*.log' > .gitignore
```

`token` is a secret, `playpause` is a rebuildable artifact, logs are runtime
noise — none belong in version control. `playpause.swift`, `latch-server.mjs`,
`latch-doctor.sh`, the plist template, `CONTEXT.md`, this plan, and the README
are tracked.

---

## Task 1 — Swift media-key helper

Create `playpause.swift`:

```swift
// Posts the system Play/Pause media key. macOS routes it to the active
// now-playing app — Music, Spotify, browser video, podcasts.
import Cocoa

func mediaKey(_ key: Int32) {
  for down in [true, false] {
    let flags = NSEvent.ModifierFlags(rawValue: UInt(down ? 0xA00 : 0xB00))
    let data1 = Int((key << 16) | ((down ? 0xA : 0xB) << 8))
    NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags,
      timestamp: 0, windowNumber: 0, context: nil, subtype: 8, data1: data1, data2: -1)?
      .cgEvent?.post(tap: .cghidEventTap)
  }
}
mediaKey(16)   // NX_KEYTYPE_PLAY → toggle play/pause
```

Compile and verify:

```
cd ~/Work/Personal/latch
swiftc playpause.swift -o playpause
test -x ./playpause && echo "helper built"
```

Note: running `./playpause` does nothing until Accessibility is granted (manual
step below). That is expected — not a failure. **Reminder:** every recompile may
void the Accessibility grant; re-grant after rebuilding.

## Task 2 — Token file

```
openssl rand -hex 16 > ~/Work/Personal/latch/token
chmod 600 ~/Work/Personal/latch/token
```

## Task 3 — The Server

Create `latch-server.mjs`. Note: header-based auth, no `crypto` import, plain
compare, and tokenless logging.

```js
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DIR    = new URL('.', import.meta.url);
const TOKEN  = readFileSync(new URL('token', DIR), 'utf8').trim();
const HELPER = new URL('playpause', DIR).pathname;   // sibling compiled binary

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  // Header auth. Plain compare is fine for a 128-bit random token.
  if ((req.headers['x-latch-token'] ?? '') !== TOKEN) {
    log(req.method, pathname, 401);
    res.writeHead(401); return res.end();
  }
  if (req.method === 'POST' && pathname === '/playpause') {
    return execFile(HELPER, [], (e) => {
      const code = e ? 500 : 204;
      log(req.method, pathname, code);
      res.writeHead(code); res.end();
    });
  }
  log(req.method, pathname, 404);
  res.writeHead(404); res.end();
}).listen(8787, '0.0.0.0', () => console.log('Latch ready on :8787'));

// Never log the URL query, headers, or token — method + path + status only.
function log(method, path, status) {
  console.log(`${new Date().toISOString()} ${method} ${path} -> ${status}`);
}
```

## Task 4 — Smoke test the endpoints

Confirms the gate and routing (not that media actually toggles — that's the
manual test). The token travels in the header:

```
node ~/Work/Personal/latch/latch-server.mjs &
SRV=$!
T=$(cat ~/Work/Personal/latch/token)

# valid → 204
curl -sS -o /dev/null -w 'valid: %{http_code}\n' -X POST -H "X-Latch-Token: $T"     http://localhost:8787/playpause
# bad token → 401
curl -sS -o /dev/null -w 'bad:   %{http_code}\n' -X POST -H "X-Latch-Token: wrong"  http://localhost:8787/playpause
# missing token → 401
curl -sS -o /dev/null -w 'none:  %{http_code}\n' -X POST                            http://localhost:8787/playpause
# wrong path → 404
curl -sS -o /dev/null -w 'path:  %{http_code}\n' -X POST -H "X-Latch-Token: $T"     http://localhost:8787/nope
# wrong method → 404
curl -sS -o /dev/null -w 'get:   %{http_code}\n'         -H "X-Latch-Token: $T"     http://localhost:8787/playpause

kill $SRV
```

Expected: `204`, `401`, `401`, `404`, `404`. If `valid` returns `500`, the helper
isn't runnable yet — most likely Accessibility hasn't been granted (manual step),
which is fine at this stage; note it and continue.

## Task 5 — Autostart at login

Create `~/Library/LaunchAgents/com.latch.server.plist`. Uses the stable Homebrew
node symlink and adds log paths so failures are diagnosable:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.latch.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/satejbidvai/Work/Personal/latch/latch-server.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/satejbidvai/Work/Personal/latch/latch.log</string>
  <key>StandardErrorPath</key><string>/Users/satejbidvai/Work/Personal/latch/latch.log</string>
</dict>
</plist>
```

Then load it with the **modern** launchctl syntax (verified June 2026 — the old
`launchctl load`/`unload` are deprecated legacy subcommands and are flaky from
macOS Ventura onward):

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.latch.server.plist
# to stop/unload later:  launchctl bootout gui/$(id -u)/com.latch.server
```

See the Gotchas note about Accessibility under `launchd`.

> **Why `/opt/homebrew/bin/node`, not the resolved Cellar path:** the symlink is
> stable across node patch upgrades; the Cellar path (`.../26.0.0/...`) moves on
> every upgrade and would break `launchd` silently.

## Task 6 — Diagnostic script `latch-doctor.sh`

Create `latch-doctor.sh` — one command to run when a tap does nothing. It should
check and report, in plain language:

- Is the Server process up? (`pgrep -f latch-server.mjs`)
- Is port `8787` listening? (`lsof -iTCP:8787 -sTCP:LISTEN`)
- Is the LaunchAgent loaded? (`launchctl list | grep com.latch.server`)
- Any recent errors in `latch.log`? (tail the log — it contains no secrets)
- Does a local POST get `204`/`401`/`500`? (`curl` with the token, to tell "grant
  missing → 500" apart from "server down → connection refused")
- Print the current Shortcut URL: `http://$(scutil --get LocalHostName).local:8787/playpause`

Make it executable (`chmod +x latch-doctor.sh`). It must never print the token.

## Task 7 — Generate the README

Write `README.md`. The Shortcut URL doesn't carry the token (it's a header), so
compute the bare URL:

```
echo "http://$(scutil --get LocalHostName).local:8787/playpause"
```

The README must include: that resolved `.local` URL, the **header** setup for the
Shortcut, the Accessibility instructions, the rotation procedure, and the gotchas
below.

---

## Manual steps (for the user — put them in the README)

1. **Grant Accessibility to the Helper.** System Settings → Privacy & Security →
   Accessibility → `+` → add `~/Work/Personal/latch/playpause`. This is what lets
   it post the media key. If autostart still does nothing after this, also grant
   `/opt/homebrew/bin/node` (broader, and voided by `brew upgrade node`). If
   neither helps, also try adding the Helper and/or node under **Input
   Monitoring** in the same Privacy pane — posting a HID event is governed by
   Accessibility on current macOS, but the TCC boundary between Accessibility,
   Input Monitoring (`ListenEvent`), and `PostEvent` has shifted across releases,
   so Input Monitoring is the documented fallback. (Verified June 2026.)
2. **Build the iPhone Shortcut.** Shortcuts app → new shortcut → add
   `Get Contents of URL` → paste the resolved URL (no token in it) → `Show More`
   → Method `POST`, empty body → under **Headers**, add key `X-Latch-Token` with
   your token string as the value → name it (e.g. "⏯ Mac"), pick an icon, save.
   Add it to the Shortcuts widget stack.
3. **Test for real.** Play something, tap the widget tile. It should toggle.
   Toggle again to confirm both directions.

---

## Token rotation (recovery valve) — put in the README

If the token leaks or you want to rotate:

```
openssl rand -hex 16 > ~/Work/Personal/latch/token && chmod 600 ~/Work/Personal/latch/token
launchctl kickstart -k gui/$(id -u)/com.latch.server   # restart so it re-reads the token
```

Then update the `X-Latch-Token` header value in the iPhone Shortcut.

---

## Gotchas / troubleshooting (include in README)

- **Accessibility + autostart (TCC):** macOS attributes the grant to the posting
  process. Under `launchd` the grant on `playpause` alone may not be honored — if
  the key does nothing under autostart but works when you run the Server from a
  Terminal that has Accessibility, grant `/opt/homebrew/bin/node` as well.
- **Grant voided by rebuilds/upgrades:** recompiling `playpause` or running
  `brew upgrade node` can silently invalidate the Accessibility grant. Symptom:
  `204` returned, nothing happens. Fix: re-add the grant. Run `latch-doctor.sh`.
- **Roaming is unsafe:** the Server binds `0.0.0.0`, so on untrusted Wi-Fi anyone
  who learns the token (or any website you browse, via a drive-by POST without
  the header) is a concern. Only run on your trusted LAN; unload the agent when
  traveling: `launchctl bootout gui/$(id -u)/com.latch.server`.
- **Media-key trick is unverified on macOS 26:** the `NSEvent.systemDefined` /
  `subtype: 8` posting technique traces to a 2007 Rogue Amoeba write-up and is
  still the canonical community approach, but it uses semi-private behavior and
  was *not* confirmed working on macOS 26 by web research (June 2026) — no
  breakage reports, but no positive confirmation either. Task 1 + the manual
  "Test for real" step are the actual proof. If the key never fires even with the
  grant in place, this is the first thing to suspect.
- **Hostname over IP:** use `<LocalHostName>.local`, not the raw IP — the IP can
  change with DHCP; the `.local` name is stable via Bonjour. If you rename the
  Mac, the URL changes — update the Shortcut.
- **Port in use:** if `:8787` is taken, pick another port and update the Server,
  the plist, and the README URL.

---

## Definition of done

_(Updated to match the shipped Shortcuts-based build — see the amendment at top.)_

- `~/Work/Personal/latch/` is a git repo containing `latch-server.mjs`,
  `latch-doctor.sh`, `com.latch.server.plist`, `token` (mode 600, git-ignored),
  `CONTEXT.md`, this plan, and `README.md`. (No `playpause.swift` — the Helper is
  the **Mac Shortcut** `Play/Pause Media`, run via `shortcuts run`.)
- Smoke test returns `204 / 401 / 401 / 404 / 404`, and a valid POST actually
  toggles play/pause through the live LaunchAgent (verified, incl. browser video).
- README contains the resolved `.local` URL, the `X-Latch-Token` header setup, the
  Mac-Shortcut requirement, and the rotation procedure.
- The LaunchAgent is loaded with logging configured.
- All security invariants above are intact — including invariant 7 (no secrets in
  logs).
