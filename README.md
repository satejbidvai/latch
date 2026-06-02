# Latch

A one-button remote that toggles **play/pause** on this Mac from an iPhone
Shortcut. The phone sends a header-authenticated `POST` over the trusted local
network; a tiny Node server runs the macOS `shortcuts` CLI, which invokes a saved
Shortcut whose **Play/Pause** action toggles whatever owns the now-playing
session (Music, Spotify, **browser video**, podcasts, the TV app).

> **Why a Shortcut and not a media-key helper?** The original plan posted a
> synthetic `NX_KEYTYPE_PLAY` media key from a compiled Swift binary. On macOS 26
> that no longer works: synthetic media events are ignored by the now-playing
> system, and the private `MediaRemote` send-command API is entitlement-gated
> (returns success, does nothing). Apple's first-party **Play/Pause** Shortcuts
> action is properly entitled and works generically — so Latch shells out to it.
> No Accessibility grant, no Swift, no TCC dance. See `PLAN.md` for the full trail.

> Threat model: **trusted home LAN only.** Plain HTTP, bound to `0.0.0.0`. The
> server is **not** safe on untrusted Wi-Fi — unload the agent when roaming (see
> [Roaming](#roaming-is-unsafe)).

## Your Shortcut URL

```
http://satej-aurasell-mb-pro.local:8787/playpause
```

This uses the Bonjour `.local` name (stable across DHCP), not a raw IP. If you
rename the Mac, recompute it with:

```sh
echo "http://$(scutil --get LocalHostName).local:8787/playpause"
```

## One-time setup

### 1. The macOS "Play/Pause Media" Shortcut

The server runs a saved Shortcut named **`Play/Pause Media`** (set as `SHORTCUT`
in `latch-server.mjs`). It must exist in your Shortcuts library and contain a
single **Play/Pause** action.

Check it's there:

```sh
shortcuts list | grep "Play/Pause Media"
```

If it's missing: open Shortcuts.app → new shortcut → add the **Play/Pause**
action → name it exactly `Play/Pause Media` → save. (Or rename the `SHORTCUT`
constant in `latch-server.mjs` to match a shortcut you already have, then restart
the agent.)

### 2. Build the iPhone Shortcut

Shortcuts app → new shortcut → add **Get Contents of URL**:

- **URL**: the Shortcut URL above (no token in it).
- Tap **Show More** → **Method**: `POST`, leave the request body empty.
- Under **Headers**, add a header:
  - Key: `X-Latch-Token`
  - Value: your token string (`cat ~/Work/Personal/latch/token`)
- Name it (e.g. "⏯ Mac"), pick an icon, save. Add it to the Shortcuts widget
  stack for one-tap access.

### 3. Test for real

Play something, tap the widget tile — it should toggle. Tap again to confirm
both directions.

## How it works

- **`latch-server.mjs`**: zero-dependency Node stdlib HTTP server. One route,
  `POST /playpause`, gated by the `X-Latch-Token` header (plain compare — a
  128-bit random token makes timing attacks irrelevant). Bound to `0.0.0.0:8787`.
  On a valid request it runs `shortcuts run "Play/Pause Media"`. Logs **method +
  path + status only** — never the URL query, headers, or token.
- **`com.latch.server.plist`**: LaunchAgent that autostarts the server at login
  via the stable `/opt/homebrew/bin/node` symlink, logging to `latch.log`.
- **`latch-doctor.sh`**: diagnostics for silent failures.

Responses: `204` success, `401` missing/wrong token, `404` otherwise, `500` if
`shortcuts run` failed (usually: the shortcut doesn't exist).

## Managing the agent

```sh
# Load / start at login (modern launchctl syntax):
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.latch.server.plist

# Stop / unload:
launchctl bootout gui/$(id -u)/com.latch.server

# Restart (e.g. after rotating the token or renaming the shortcut):
launchctl kickstart -k gui/$(id -u)/com.latch.server
```

If you edit `com.latch.server.plist` in the repo, copy it to
`~/Library/LaunchAgents/` and re-bootstrap.

## Token rotation (recovery valve)

```sh
openssl rand -hex 16 > ~/Work/Personal/latch/token && chmod 600 ~/Work/Personal/latch/token
launchctl kickstart -k gui/$(id -u)/com.latch.server   # restart so it re-reads the token
```

Then update the `X-Latch-Token` header value in the iPhone Shortcut.

## Diagnostics

When a tap does nothing, run:

```sh
~/Work/Personal/latch/latch-doctor.sh
```

It checks the process, the port, the LaunchAgent, recent log lines, a live local
POST, and that the configured shortcut exists. It never prints the token.

## Gotchas / troubleshooting

- **Shortcut must exist and be named exactly:** if `shortcuts list` doesn't show
  `Play/Pause Media`, the endpoint returns `500`. Create it or fix the `SHORTCUT`
  name in `latch-server.mjs` and restart the agent.
- **`shortcuts run` and stdin:** the CLI reads stdin until EOF, so a naive spawn
  hangs forever. The server closes the child's stdin (`child.stdin.end()`) and
  sets a 10 s timeout. If you rewrite the spawn, keep both.
- <a id="roaming-is-unsafe"></a>**Roaming is unsafe:** the server binds
  `0.0.0.0`, so on untrusted Wi-Fi anyone who learns the token (or any website
  you browse, via a drive-by POST without the header) is a concern. Only run on
  your trusted LAN; unload the agent when traveling:
  `launchctl bootout gui/$(id -u)/com.latch.server`.
- **Hostname over IP:** use `<LocalHostName>.local`, not the raw IP — the IP can
  change with DHCP. If you rename the Mac, the URL changes — update the Shortcut.
- **Port in use:** if `:8787` is taken, pick another port and update
  `latch-server.mjs`, the plist, and this README's URL.
- **Leftover grants:** earlier iterations granted Accessibility to `playpause`
  and `/opt/homebrew/bin/node`. This approach needs neither — you can remove both
  from System Settings → Privacy & Security → Accessibility.
