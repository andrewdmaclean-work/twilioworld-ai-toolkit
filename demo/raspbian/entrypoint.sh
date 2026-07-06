#!/bin/bash
# demo/raspbian/entrypoint.sh — start the PIXEL desktop over VNC as the
# non-root "pi" user, wait for it, then serve it via noVNC on :8080.
set -euo pipefail

rm -f /home/pi/.vnc/*.pid /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

echo "Starting Raspberry Pi PIXEL desktop on VNC display :1 ..."
su pi -c "vncserver :1 -geometry 1280x800 -depth 24 -SecurityTypes None"

for i in $(seq 1 30); do
  if (echo > /dev/tcp/127.0.0.1/5901) >/dev/null 2>&1; then
    echo "VNC display :1 is up."
    break
  fi
  sleep 0.5
done

echo "Starting noVNC (websockify) on :8080 -> localhost:5901 ..."
exec websockify --web=/usr/share/novnc 0.0.0.0:8080 localhost:5901
