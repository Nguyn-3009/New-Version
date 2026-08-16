// Game rules that aren't geometry and aren't level data.
//
// Lives are spent on COLLISIONS, not on taps. Tapping a blocked arrow and
// watching it bump back is the game telling you your read was wrong, so that
// is the thing worth costing something. Tapping an arrow that escapes cleanly
// is free, however many you tap.

export const LIVES_BY_SOURCE = {
  level: 3,
  daily: 3,
  // Photo boards are far bigger and were never hand-tuned for difficulty, so
  // a misread is much easier and the run is much longer. Three lives across
  // thousands of arrows would be punishing rather than tense.
  photo: 5,
};

export const DEFAULT_LIVES = 3;

export function livesFor(meta) {
  return LIVES_BY_SOURCE[meta?.source] ?? DEFAULT_LIVES;
}