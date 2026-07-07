export const TRANSITION_GUARD_MS = 200;

export function createInputGuard(delayMs = TRANSITION_GUARD_MS): {
  arm: () => void;
  ready: () => boolean;
} {
  let armed = false;
  return {
    arm: () => {
      armed = false;
      setTimeout(() => { armed = true; }, delayMs);
    },
    ready: () => armed,
  };
}
