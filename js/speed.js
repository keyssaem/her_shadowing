// Auto speed steps: each full play of a scene moves it closer to your base speed.
// The steps are offsets from the "말하기 속도" setting, so both settings work together.

export const SPEED_OFFSETS = [-0.15, -0.05, 0];

const round = (v) => Math.round(v * 100) / 100;

/** Speech rate for a scene that has been fully played `plays` times. */
export function speedFor(plays, base, auto = true) {
  if (!auto) return round(base);
  const off = SPEED_OFFSETS[Math.min(plays, SPEED_OFFSETS.length - 1)];
  return round(Math.max(0.5, base + off));
}

/** Is this the last (full-speed) step? */
export const isFullSpeed = (plays) => plays >= SPEED_OFFSETS.length - 1;
