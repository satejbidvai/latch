# Latch

A one-button remote that toggles **play/pause** on this Mac from an iPhone
Shortcut. The phone sends a header-authenticated `POST` over the trusted local
network; a tiny Node server calls the private `MediaRemote.framework` via
`osascript` (JXA), which toggles whatever owns the now-playing session (Music,
Spotify, **browser video**, podcasts, the TV app).

> **Evolution:** The original plan posted a synthetic `NX_KEYTYPE_PLAY` media key
> from a compiled Swift binary; on macOS 26 that stopped working. Next, a saved
> macOS Shortcut wrapping Apple's Play/Pause action (worked, but added an
> unnecessary dependency). Now, a direct JXA call to `MediaRemote.framework`'s
> `kMRTogglePlayPause` via `osascript`: zero dependencies, system-wide, confirmed
> working on macOS 15.4+ through 26.2. See `PLAN.md` for the full trail.

> Threat model: **trusted home LAN only.** Plain HTTP, bound to `0.0.0.0`. The
> server is **not** safe on untrusted Wi-Fi. Unload the agent when roaming (see
> [Roaming](#roaming-is-unsafe)).

## Your Shortcut URL

```sh
echo "http://$(scutil --get LocalHostName).local:8787/playpause"
```

This uses the Bonjour `.local` name (stable across DHCP), not a raw IP. Run the
command above to get your URL. If you rename the Mac, re-run it and update the
Shortcut.

## One-time setup

### 1. Build the iPhone Shortcut

Shortcuts app → new shortcut → add **Get Contents of URL**:

- **URL**: the Shortcut URL above (no token in it).
- Tap **Show More** → **Method**: `POST`, leave the request body empty.
- Under **Headers**, add a header:
  - Key: `X-Latch-Token`
  - Value: your token string (`cat token` from the repo root)
- Name it (e.g. "⏯ Mac"), pick an icon, save. Add it to the Shortcuts widget
  stack for one-tap access.

### 2. Test for real

Play something, tap the widget tile. It should toggle. Tap again to confirm
both directions.

## How it works

- **`latch-server.mjs`**: zero-dependency Node stdlib HTTP server. One route,
  `POST /playpause`, gated by the `X-Latch-Token` header (plain compare; a
  128-bit random token makes timing attacks irrelevant). Bound to `0.0.0.0:8787`.
  On a valid request it calls `osascript -l JavaScript` with a JXA snippet that
  loads `MediaRemote.framework` and sends `kMRTogglePlayPause` (command 2).
  Logs method + path + status only. Never the URL query, headers, or token.
- **`com.latch.server.plist`**: LaunchAgent that autostarts the server at login
  via the stable `/opt/homebrew/bin/node` symlink, logging to `latch.log`.
- **`latch-doctor.sh`**: diagnostics for silent failures.

Responses: `204` success, `401` missing/wrong token, `404` otherwise, `500` if
`osascript` failed.

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

## Token rotation

```sh
openssl rand -hex 16 > token && chmod 600 token
launchctl kickstart -k gui/$(id -u)/com.latch.server   # restart so it re-reads the token
```

Then update the `X-Latch-Token` header value in the iPhone Shortcut.

## Diagnostics

When a tap does nothing, run:

```sh
./latch-doctor.sh
```

It checks the process, the port, the LaunchAgent, recent log lines, a live local
POST, and that the configured shortcut exists. It never prints the token.

## Gotchas / troubleshooting

- <a id="roaming-is-unsafe"></a>**Roaming is unsafe:** the server binds
  `0.0.0.0`, so on untrusted Wi-Fi anyone who discovers the token is a concern.
  Only run on your trusted LAN; unload the agent when traveling:
  `launchctl bootout gui/$(id -u)/com.latch.server`.
- **Hostname over IP:** use `<LocalHostName>.local`, not the raw IP. The IP can
  change with DHCP. If you rename the Mac, the URL changes; update the Shortcut.
- **Port in use:** if `:8787` is taken, pick another port and update
  `latch-server.mjs`, the plist, and this README's URL.
- **Leftover grants:** earlier iterations granted Accessibility to `playpause`
  and `/opt/homebrew/bin/node`. This approach needs neither. Remove both from
  System Settings → Privacy & Security → Accessibility.
