# Isolated GUI Desktop for the Demo

A full Ubuntu XFCE desktop, streamed to your browser via noVNC. You open a
real terminal on a real (disposable) Linux desktop, `git clone` the repo on
camera, and run `./toolkit` — all inside a container, nothing touching your
Mac.

## Supply chain

The image is built from the **official `ubuntu:24.04`** base and installs
packages **only from Ubuntu's own signed apt repositories**. No third-party
apt sources, no `curl | bash` installers baked in, no community images.

One runtime caveat: `./toolkit` needs Node >= 22 + bun. Ubuntu 24.04 ships
Node 18, so the Dockerfile deliberately does NOT preinstall Node/bun (that
would mean a non-Ubuntu source). On first run, `./toolkit` bootstraps bun
itself from bun.sh at runtime. If you want a fully air-gapped/official-only
run with no runtime fetch, use the `demo/gui` web server route instead, or
add `nodejs npm` (Ubuntu's Node 18) to the Dockerfile and use it only for
tooling that tolerates 18.

## Already built and running

The image `toolkit-gui-desktop` is built and a container named
`toolkit-desktop` is running. Just open:

  http://localhost:8080/vnc.html

Click **Connect** (no password — auth is disabled inside this throwaway
container). You'll land on the XFCE desktop. Open a terminal from the
Applications menu (or right-click desktop -> Open Terminal Here).

## Lifecycle

Build (only needed again if you edit the Dockerfile):

    cd /Users/amaclean/Documents/GitHub/twilioworld-ai-toolkit
    docker build -t toolkit-gui-desktop -f demo/desktop/Dockerfile demo/desktop

Run (fresh container):

    docker run -d --name toolkit-desktop --shm-size=1g -p 8080:8080 toolkit-gui-desktop

Run with a host folder shared in (read-only, appears at /demo_files):

    docker run -d --name toolkit-desktop --shm-size=1g -p 8080:8080 \
      -v "$HOME/Desktop/demo-folder:/demo_files:ro" toolkit-gui-desktop

Run fully offline (no internet — note ./toolkit's bun bootstrap will fail
without network, so only use this once everything's already installed):

    docker run -d --name toolkit-desktop --shm-size=1g -p 8080:8080 \
      --network none toolkit-gui-desktop

Stop / start / remove:

    docker stop toolkit-desktop
    docker start toolkit-desktop
    docker rm -f toolkit-desktop

## Inside the desktop, on camera

1. Open a terminal (Applications -> Terminal Emulator).
2. Clone the repo:

       git clone https://github.com/<your-org>/twilioworld-ai-toolkit.git
       cd twilioworld-ai-toolkit

3. Run the toolkit:

       ./toolkit

   (First launch bootstraps bun, then opens the TUI dashboard right there
   in the terminal window on the Linux desktop.)

## Notes

- `--shm-size=1g` matters: XFCE/Xorg needs shared memory or the desktop can
  render as a gray/black screen.
- The container is fully disposable. `docker rm -f toolkit-desktop` and it's
  gone — nothing was written to your Mac.
