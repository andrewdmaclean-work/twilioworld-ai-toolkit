# demo/desktop/Dockerfile — Ubuntu + XFCE desktop, streamed via noVNC in a
# browser tab. Built for recording a demo: open a real terminal app on a
# real (if disposable) Linux desktop, `git clone` the repo on camera, then
# run ./toolkit or the GUI server — all inside a container, nothing touches
# the host.
#
# Fixes vs. the reference Dockerfile:
#   - tightvncserver 1.3.10 (legacy, 2015) does NOT support -SecurityTypes
#     None — that flag is TigerVNC-only. Swapped to tigervnc-standalone-server,
#     which ships the same `vncserver` command and actually supports it.
#   - `vncserver` daemonizes and exits immediately; it can't be the thing
#     websockify wraps with `--`. Also, websockify's `--` wrap-mode and a
#     literal target_addr:port are mutually exclusive CLI forms. Fixed by
#     starting vncserver first (entrypoint.sh), then running websockify in
#     plain reverse-proxy mode against it.
#   - No xstartup file = gray screen, not XFCE. Added one.
#   - Runs as a non-root user ("demo") — the real ./toolkit script refuses
#     to run as root, and it's also just correct VNC/XFCE practice.
#
# Build:  docker build -t toolkit-gui-desktop -f demo/desktop/Dockerfile demo/desktop
# Run:    see demo/desktop/README.md (docker run one-liner + lifecycle)

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# ── Layered dependencies ────────────────────────────────────────────────
# Supply-chain note: EVERYTHING here comes from Ubuntu's own signed apt
# repositories on the official ubuntu:24.04 base image. No third-party
# apt sources, no curl|bash installers, no community images. That's the
# whole point — nothing enters this image that Ubuntu didn't sign.
#
# We deliberately do NOT install Node or bun here: the toolkit's own
# ./toolkit bootstrapper installs bun on first run (from bun.sh), so if
# you want to keep the image 100% official-only, you can run the GUI
# server route or let ./toolkit fetch bun at runtime on camera. If you'd
# rather bake Node in from Ubuntu's repo too, add `nodejs npm` to the
# list below — note Ubuntu 24.04 ships Node 18, which is older than the
# toolkit's >=22 requirement, so ./toolkit itself needs runtime bun.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xfce4 \
      xfce4-goodies \
      tigervnc-standalone-server \
      tigervnc-common \
      novnc \
      websockify \
      dbus-x11 \
      sudo \
      bash \
      git \
      curl \
      ca-certificates \
      unzip \
      xterm \
      epiphany-browser \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root desktop user ────────────────────────────────────────────────
RUN useradd -m -s /bin/bash demo \
    && echo "demo:demo" | chpasswd \
    && usermod -aG sudo demo \
    && echo "demo ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER demo
WORKDIR /home/demo

# ── VNC session config (build-time, stateless) ──────────────────────────
RUN mkdir -p /home/demo/.vnc && \
    printf '%s\n' \
      '#!/bin/sh' \
      'unset SESSION_MANAGER' \
      'unset DBUS_SESSION_BUS_ADDRESS' \
      'exec startxfce4' \
      > /home/demo/.vnc/xstartup && \
    chmod +x /home/demo/.vnc/xstartup

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/demo_files"]
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
