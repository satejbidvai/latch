#!/usr/bin/env bash
# latch-doctor — run this when a tap does nothing. Reports in plain language.
# Never prints the token.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8787

echo "== Latch doctor =="

# 1. Server process up?
if pgrep -f latch-server.mjs >/dev/null; then
  echo "[ok]   Server process is running (latch-server.mjs)."
else
  echo "[FAIL] Server process not found. The LaunchAgent may not be loaded."
fi

# 2. Port listening?
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ok]   Port $PORT is listening."
else
  echo "[FAIL] Nothing is listening on port $PORT."
fi

# 3. LaunchAgent loaded?
if launchctl list 2>/dev/null | grep -q com.latch.server; then
  echo "[ok]   LaunchAgent com.latch.server is loaded."
else
  echo "[warn] LaunchAgent com.latch.server is not loaded."
  echo "       Load it: launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.latch.server.plist"
fi

# 4. Recent log lines (contains no secrets — method + path + status only).
if [ -f "$DIR/latch.log" ]; then
  echo "[info] Last log lines:"
  tail -n 5 "$DIR/latch.log" | sed 's/^/       /'
else
  echo "[info] No latch.log yet."
fi

# 5. Live local POST with the token — distinguishes grant-missing (500) from
#    server-down (connection refused).
if [ -f "$DIR/token" ]; then
  T="$(tr -d '[:space:]' < "$DIR/token")"
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 \
    -X POST -H "X-Latch-Token: $T" "http://localhost:$PORT/playpause" 2>/dev/null)"
  RC=$?
  if [ "$RC" -ne 0 ]; then
    echo "[FAIL] Local POST failed to connect (server down or wrong port)."
  elif [ "$CODE" = "204" ]; then
    echo "[ok]   Local POST -> 204. Server, auth, and the shortcut ran."
  elif [ "$CODE" = "500" ]; then
    echo "[FAIL] Local POST -> 500. 'shortcuts run' failed. Check the shortcut"
    echo "       named in latch-server.mjs (SHORTCUT) exists: shortcuts list"
  elif [ "$CODE" = "401" ]; then
    echo "[FAIL] Local POST -> 401. Token mismatch between file and request."
  else
    echo "[warn] Local POST -> $CODE (unexpected)."
  fi
else
  echo "[FAIL] No token file found at $DIR/token."
fi

# 5b. Does the configured shortcut exist?
SC="$(sed -n "s/^const SHORTCUT *= *'\\([^']*\\)'.*/\\1/p" "$DIR/latch-server.mjs" | head -1)"
if [ -n "$SC" ]; then
  if shortcuts list 2>/dev/null | grep -qxF "$SC"; then
    echo "[ok]   Shortcut \"$SC\" exists in your library."
  else
    echo "[FAIL] Shortcut \"$SC\" not found. Create it (one Play/Pause action)"
    echo "       or fix the SHORTCUT name in latch-server.mjs."
  fi
fi

# 6. The Shortcut URL.
echo "[info] Shortcut URL: http://$(scutil --get LocalHostName).local:$PORT/playpause"
