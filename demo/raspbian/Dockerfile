# demo/raspbian/Dockerfile — "Raspbian-in-a-container".
#
# Honest scope: real Raspberry Pi OS is a full disk image that boots its
# own kernel on Pi hardware/QEMU — it does NOT run as a Docker container.
# What DOES work, and is what this builds: the exact Raspbian *userland +
# desktop* — Debian bookworm (the release Pi OS 12 is built on) plus the
# official Raspberry Pi PIXEL desktop metapackage from Raspberry Pi's own
# apt archive. arm64-native on Apple Silicon, streamed to a browser via
# noVNC, and meant to be run capped to Pi 4 resources (see README).
#
# Supply chain: two sources only, both first-party and both signed —
#   - official debian:bookworm base image + Debian's own apt repos
#   - Raspberry Pi's official archive (archive.raspberrypi.org), pinned
#     with its signing key via [signed-by=...]
# No community images, no curl|bash app installers baked in.
#
# Build: docker build -t toolkit-raspbian -f demo/raspbian/Dockerfile demo/raspbian
# Run:   see demo/raspbian/README.md (includes the Pi 4 resource caps)

FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive

# ── Raspberry Pi official archive key + source ───────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      gnupg curl ca-certificates \
    && curl -fsSL https://archive.raspberrypi.org/debian/raspberrypi.gpg.key \
         | gpg --dearmor -o /usr/share/keyrings/raspberrypi-archive-keyring.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/raspberrypi-archive-keyring.gpg] http://archive.raspberrypi.org/debian/ bookworm main' \
         > /etc/apt/sources.list.d/raspi.list \
    && rm -rf /var/lib/apt/lists/*

# ── Layered dependencies: PIXEL desktop + VNC/noVNC + demo runtimes ──────
# raspberrypi-ui-mods pulls in the base PIXEL desktop (LXDE/openbox +
# Pi theming), but --no-install-recommends skips its actual panel
# plugins — the Start Menu, network/battery/volume/updater icons are
# each a SEPARATE package (lxplug-*), not bundled into the base install.
# Without them, lxpanel logs "can't load smenu/netman/batt/... plugin"
# and you get a bare gray panel with no menu and no desktop icons. Pulled
# in explicitly here (the X11/lxpanel set only — NOT the wf*/wayland
# variants raspberrypi-ui-mods also recommends, which this VNC/X11 setup
# doesn't use).
#
# Everything below is from Debian's official repos or the Raspberry Pi
# archive pinned above. Node/bun are intentionally omitted (Debian ships
# Node 18; ./toolkit bootstraps its own bun at runtime — same note as the
# XFCE image).
RUN apt-get update && apt-get install -y --no-install-recommends \
      raspberrypi-ui-mods \
      chromium \
      rpi-chromium-mods \
      lxplug-menu \
      lxplug-network \
      lxplug-netman \
      lxplug-volume \
      lxplug-volumepulse \
      lxplug-batt \
      lxplug-cpu \
      lxplug-cputemp \
      lxplug-ejecter \
      lxplug-updater \
      lxplug-magnifier \
      fonts-piboto \
      rpd-wallpaper \
      pixflat-icons \
      pixflat-theme \
      gnome-icon-theme \
      scrot \
      lxterminal \
      epiphany-browser \
      pi-package \
      locales \
      fonts-dejavu \
      fonts-noto-core \
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
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── UTF-8 locale ─────────────────────────────────────────────────────────
# Without a generated UTF-8 locale, LXTerminal/xterm can't decode the
# multi-byte box-drawing, arrow, and symbol glyphs the OpenTUI dashboard
# emits (╔ ═ │ ─ ▶ ✓ ✗ → · …). They render as "???"/garbage blobs and the
# whole TUI frame corrupts. Generate en_US.UTF-8 and export it globally so
# every shell (including the non-login VNC session) inherits it. The
# fonts-dejavu / fonts-noto-core packages above provide the actual glyphs.
RUN sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen \
    && locale-gen \
    && update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# ── Non-root desktop user (matches the classic Pi "pi" user idea) ────────
RUN useradd -m -s /bin/bash pi \
    && echo "pi:raspberry" | chpasswd \
    && usermod -aG sudo pi \
    && echo "pi ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER pi
WORKDIR /home/pi

# ── VNC session -> PIXEL desktop (build-time, stateless) ─────────────────
# On real hardware, Raspberry Pi's first-boot wizard (piwiz) copies the
# package-shipped default panel/desktop config from /etc/xdg/*/LXDE-pi
# into the user's ~/.config. That wizard never runs here, so lxpanel and
# pcmanfm would otherwise silently generate blank stub configs on first
# launch (empty panel, no desktop icons). Seed the real defaults directly
# at build time instead — keeps this stateless/reproducible per the
# project's "config happens at build time" rule.
RUN mkdir -p /home/pi/.config/lxpanel /home/pi/.config/pcmanfm /home/pi/.config/lxsession && \
    cp -r /etc/xdg/lxpanel/LXDE-pi /home/pi/.config/lxpanel/ && \
    cp -r /etc/xdg/pcmanfm/LXDE-pi /home/pi/.config/pcmanfm/ && \
    cp -r /etc/xdg/lxsession/LXDE-pi /home/pi/.config/lxsession/ && \
    mkdir -p /home/pi/.config/lxterminal && \
    printf '%s\n' \
      '[general]' \
      'fontname=DejaVu Sans Mono 11' \
      'scrollback=10000' \
      'bgcolor=rgb(0,0,0)' \
      'fgcolor=rgb(211,211,211)' \
      'disallowbold=false' \
      > /home/pi/.config/lxterminal/lxterminal.conf && \
    mkdir -p /home/pi/.vnc && \
    printf '%s\n' \
      '#!/bin/sh' \
      'unset SESSION_MANAGER' \
      'unset DBUS_SESSION_BUS_ADDRESS' \
      'export LANG=en_US.UTF-8' \
      'export LC_ALL=en_US.UTF-8' \
      'exec startlxde-pi' \
      > /home/pi/.vnc/xstartup && \
    chmod +x /home/pi/.vnc/xstartup

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Chromium container launcher ──────────────────────────────────────────
# Install the wrapper on PATH, and override BOTH the system .desktop entry
# and the Pi taskbar's pinned launcher so clicking Chromium in the GUI (the
# way a demo user actually would) uses the container-safe flags. Without
# this, clicking the browser icon silently does nothing.
COPY chromium-launch.sh /usr/local/bin/chromium-launch
RUN chmod +x /usr/local/bin/chromium-launch && \
    for d in /usr/share/applications/chromium.desktop \
             /usr/share/applications/chromium-browser.desktop; do \
      if [ -f "$d" ]; then \
        sed -i 's#^Exec=.*#Exec=/usr/local/bin/chromium-launch %U#' "$d"; \
      fi; \
    done

VOLUME ["/demo_files"]
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
