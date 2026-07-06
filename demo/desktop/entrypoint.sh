#!/bin/bash
# demo/desktop/entrypoint.sh — starts the VNC/XFCE session as the non-root
# "demo" user, waits for it to be listening, then runs websockify as a
# plain reverse proxy (8080 -> localhost:5901). This is the piece the
# original CMD line couldn't do in one shot: vncserver daemonizes and
# exits immediately, so it has to be started *before* websockify, not
# wrapped by it.
set -euo pipefail

# Clean up any stale lock/socket from a previous run of this container
# (harmless on a fresh container; matters if you `docker start` it again).
rm -f /home/demo/.vnc/*.pid /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

echo "Starting XFCE desktop on VNC display :1 ..."
su demo -c "vncserver :1 -geometry 1280x800 -depth 24 -SecurityTypes None"

# Wait for Xvnc to actually be listening on 5901 before websockify dials it.
for i in $(seq 1 30); do
  if (echo > /dev/tcp/127.0.0.1/5901) >/dev/null 2>&1; then
    echo "VNC display :1 is up."
    break
  fi
  sleep 0.5
done

echo "Starting noVNC (websockify) on :8080 -> localhost:5901 ..."
exec websockify --web=/usr/share/novnc 0.0.0.0:8080 localhost:5901
