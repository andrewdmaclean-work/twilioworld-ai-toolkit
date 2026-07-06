#!/bin/sh
# chromium-launch — wrapper so Chromium actually launches inside a
# container GUI. Real Chromium needs a sandbox that containers don't
# grant by default (no user namespaces / seccomp under the default
# runtime), and the Pi build also wants a writable profile dir. These
# flags make a click-to-open browser Just Work for the demo without
# weakening anything on the host — it's all scoped to this throwaway
# container.
exec /usr/bin/chromium \
  --no-sandbox \
  --test-type \
  --disable-gpu \
  --disable-dev-shm-usage \
  --user-data-dir="$HOME/.config/chromium-demo" \
  --no-first-run \
  --start-maximized \
  "$@"
