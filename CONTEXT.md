# Latch

A one-button remote that toggles play/pause on this Mac from an iPhone. The
phone sends a token-authenticated request over the trusted local network; the
Mac calls the private MediaRemote framework (via `osascript` + JXA) to toggle
whatever currently owns audio — no app-specific targeting, no Shortcuts dependency.

## Language

**Latch**:
The whole system — the iPhone trigger, the Mac listener, and the helper that
posts the media key.

**Helper**:
The mechanism the Server invokes to perform the toggle: a JXA script executed
via `osascript` that calls the private MediaRemote framework's
`kMRTogglePlayPause` command. Originally a compiled Swift binary (`playpause`)
posting a synthetic media key — abandoned because macOS 26 ignores synthetic
media events. Then a macOS Shortcuts wrapper — replaced with the direct
framework call to eliminate the Shortcuts dependency (see PLAN.md).
_Avoid_: script, tool, binary.

**Server**:
The always-on Mac-side listener that receives the trigger and runs the Helper.
Named `latch-server`.
_Avoid_: daemon, service, API.

**Token**:
The long-lived shared secret that authorizes a request. A bearer credential —
possessing it is sufficient to trigger the Latch.
_Avoid_: password, key, API key.

**Trigger**:
A single authorized request from the phone that asks the Latch to act. There is
exactly one kind.
_Avoid_: command, event, message.

**Phone Shortcut**:
The iPhone-side Apple Shortcut, built by the user, that issues the Trigger.
Distinct from the **Mac Shortcut** that the Server runs.

**Now-playing session**:
The macOS-managed notion of which app currently controls media. The Play/Pause
action is routed to whichever app owns it — the Latch never targets an app by
name.
_Avoid_: active app, current player.

**Toggle**:
The Latch's single action: flip between playing and paused. There is no explicit
"play" or "pause" and the Latch holds no knowledge of the current state.

## Relationships

- A **Phone Shortcut** issues exactly one kind of **Trigger**
- A **Trigger** is authorized by the **Token** and causes the **Server** to run the **Helper** once
- The **Helper** calls MediaRemote's toggle command, which macOS routes to the current **Now-playing session**
- The action is always a **Toggle** — never a directed play or pause

## Example dialogue

> **Dev:** "If the phone fires a **Trigger** while music is already playing, does it pause?"
> **User:** "Yes — it's a **Toggle**. The **Latch** doesn't know or care what state the **Now-playing session** is in; it just flips it."
> **Dev:** "So two taps in a row return you to the original state?"
> **User:** "Right. There's no 'play' Trigger and no 'pause' Trigger — only the one."

## Flagged ambiguities

- "command" was used loosely for the phone's request — resolved to **Trigger**, to keep it distinct from a shell command (which the Server must never build from request data).
