# "Raspbian" Desktop in a Container (Pi 4 resource-capped)

The Raspberry Pi PIXEL desktop, streamed to your browser via noVNC, running
capped to Pi 4 resources (4GB RAM, 4 CPU cores). You get the authentic
Raspbian look-and-feel to `git clone` the repo and run `./toolkit` on camera,
fully isolated from your Mac.

## What this is (and isn't)

Real Raspberry Pi OS is a full disk image that boots its own kernel on Pi
hardware (or slow QEMU full-machine emulation). It does NOT run as a Docker
container. What this image IS: the exact Raspbian **userland + PIXEL desktop**
— Debian bookworm (the release Pi OS 12 is built on) + Raspberry Pi's
official `raspberrypi-ui-mods` PIXEL desktop, arm64-native on Apple Silicon.
For a demo of the toolkit running "on a Pi-class machine," this is the
practical, fast choice.

## Supply chain

Two first-party signed sources only:
- official `debian:bookworm` base image + Debian's own apt repos
- Raspberry Pi's official archive (archive.raspberrypi.org), pinned by its
  signing key via `[signed-by=...]`

No community images, no `curl | bash` app installers baked in. (As with the
other images, `./toolkit` itself bootstraps bun from bun.sh at runtime, since
Debian ships Node 18 and the toolkit needs >=22.)

## Run it — Pi 4 (4GB / 4 cores)

    docker run -d --name toolkit-raspbian \
      --memory=4g --memory-swap=4g --cpus=4.0 --shm-size=256m \
      -p 8081:8080 toolkit-raspbian

Then open in your Mac's browser:

    http://localhost:8081/vnc.html

Click **Connect** (no password). You land on the PIXEL desktop. Open a
terminal (menu -> Accessories -> Terminal, or LXTerminal).

Other Pi specs — just change the caps:
- Pi 3 / Zero 2:  `--memory=1g --memory-swap=1g --cpus=1.0`
- Pi 4 (2GB):     `--memory=2g --memory-swap=2g --cpus=4.0`
- Pi 5 (8GB):     `--memory=8g --memory-swap=8g --cpus=4.0`

`--memory-swap` = `--memory` means no swap beyond RAM, so the container feels
the RAM ceiling exactly like real hardware (no host swap masking it).

## Share a host folder in (optional, read-only)

    docker run -d --name toolkit-raspbian \
      --memory=4g --memory-swap=4g --cpus=4.0 --shm-size=256m \
      -p 8081:8080 -v "$HOME/Desktop/demo-folder:/demo_files:ro" \
      toolkit-raspbian

## Confirmed working

A completely fresh container (built from this Dockerfile, never manually
patched) boots straight into the full PIXEL desktop: Raspberry logo Start
Menu (top-left), file manager and terminal launcher icons, network/
bluetooth/battery status icons and clock (top-right), and the default
fisherman wallpaper. Verified by screenshot before shipping this.

If you ever rebuild from scratch and the panel looks bare (just a couple
of icons, no Start Menu) — that means the `lxplug-*` panel-plugin packages
in the Dockerfile got dropped. Raspberry Pi splits the Start Menu, network
icon, battery icon, etc. into separate packages from the base
`raspberrypi-ui-mods` install; without them lxpanel silently falls back to
an empty panel instead of erroring.

## Inside the desktop, on camera

    git clone https://github.com/<your-org>/twilioworld-ai-toolkit.git
    cd twilioworld-ai-toolkit
    ./toolkit

## Lifecycle

    # build (only if you edit the Dockerfile)
    cd /Users/amaclean/Documents/GitHub/twilioworld-ai-toolkit
    docker build -t toolkit-raspbian -f demo/raspbian/Dockerfile demo/raspbian

    docker stop toolkit-raspbian
    docker start toolkit-raspbian
    docker rm -f toolkit-raspbian     # fully disposable — nothing touched your Mac

## Watch it feel the limits (nice for the demo)

In a separate Mac terminal, live resource meter:

    docker stats toolkit-raspbian

Default login inside the desktop if ever prompted: user `pi` / password
`raspberry`.

## Notes

- Port is mapped to 8081 here so it doesn't clash with the XFCE desktop
  image (8080). Use whichever you like.
- `--shm-size=256m` keeps shared memory Pi-realistic while still enough for
  the desktop to render (too low = gray screen).
