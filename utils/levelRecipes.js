// Levels and daily puzzles, as RECIPES rather than data.
//
// A level is a few numbers. Because generateLinesData is deterministic, those
// numbers rebuild the exact same puzzle on every device, every time. Nothing
// is shipped, nothing is downloaded, and level 7 in Vietnam is level 7 in
// Berlin.
//
// GENERATOR_VERSION is the catch. Change how generateLinesData builds bodies -
// the straightness bias was such a change - and the same seed produces a
// DIFFERENT puzzle. That is fine for levels (nobody notices level 7 shifting
// between app versions) but it matters for dailies and leaderboards, where two
// players on different app versions must not be solving different boards.
// Bump this when the generator changes, and treat scores from different
// versions as incomparable.
export const GENERATOR_VERSION = 3;

// Which shapes appear, and in what order, on shape levels. Add mask-maker
// output to SHAPE_MASKS and drop the key in here.
const SHAPE_ROTATION = ["heart", "diamond", "ring", "cross"];

// Photo mode stays hidden until here, so nobody's first experience is a
// 125x125 board with thousands of arrows.
export const PHOTO_UNLOCK_LEVEL = 20;

// Whether levels past the designed table are generated procedurally.
//
// This used to be unconditional, which is why levels kept existing beyond the
// end of the hand-tuned list: getLevelRecipe fell through to an open-ended
// ramp for ANY n, and the level grid drew a fixed 60 cells regardless. With
// it off, the game has exactly as many levels as you have designed.
export const ALLOW_PROCEDURAL_OVERFLOW = false;

/**
 * Difficulty comes from three dials, in order of how much they matter:
 *
 *   region       playable square. Drives arrow count roughly quadratically -
 *                this is the main dial.
 *   k            clusters. More clusters fragment regions into smaller pieces,
 *                giving more, shorter arrows and more colour rules to track.
 *   straightness high = long straight arrows that are easy to read.
 *                low  = squiggly arrows that fill space and look better, but
 *                are much harder to follow.
 */
/**
 * Levels 1-19 are BAKED. Each entry's seed was found by search so the arrow
 * count follows a smooth curve - random seeds do not produce monotonic
 * difficulty, and an early level that is easier than the one before it reads
 * as a bug to a new player.
 *
 * Difficulty comes from three dials:
 *   region       playable square, centred in the fixed 125x125 grid
 *   k            clusters; "blobs" fragments far more than "bands", so the
 *                same region yields many more arrows once k rises
 *   straightness high = long readable arrows, low = squiggly and harder
 */
const TUTORIAL = [
  { region: 5, k: 1, pattern: "solid", straightness: 0.95, seed: 2 }, // lvl 1
  { region: 5, k: 1, pattern: "solid", straightness: 0.95, seed: 1 }, // lvl 2
  { region: 5, k: 1, pattern: "solid", straightness: 0.95, seed: 7 }, // lvl 3
  { region: 5, k: 1, pattern: "solid", straightness: 0.95, seed: 34 }, // lvl 4
  { region: 8, k: 1, pattern: "solid", straightness: 0.95, seed: 2 }, // lvl 5
  { region: 14, k: 2, pattern: "bands", straightness: 0.9, seed: 1 }, // lvl 6
  { region: 14, k: 2, pattern: "bands", straightness: 0.9, seed: 7 }, // lvl 7
  { shape: "cross", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 }, // lvl 8 ~ 75 arrows
  { shape: "heart", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 }, // lvl 9 ~ 75 arrows
  { shape: "ring", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 }, // lvl 10 ~ 107 arrows
  { shape: "diamond", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 }, // lvl 11 ~ 85 arrows
  { shape: "flash", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 }, // lvl 12 ~ 183 arrows
  { shape: "joker", k: 4, pattern: "blobs", straightness: 0.66, seed: 1 },
  { shape: "eco", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 },
  { shape: "cyclops", k: 3, pattern: "blobs", straightness: 0.97, seed: 7 },
  { shape: "basketball", k: 4, pattern: "blobs", straightness: 0.65, seed: 1 },
  { shape: "eye", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 },
  { shape: "dollar_bag", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 },
  { shape: "bomb", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 },
  { shape: "football", k: 4, pattern: "blobs", straightness: 0.75, seed: 1 },
];

/** How many levels actually exist. Single source of truth for the UI. */
export const LEVEL_COUNT = TUTORIAL.length;

export function getLevelRecipe(level) {
  const n = Math.max(1, Math.floor(level));

  if (n <= TUTORIAL.length) {
    return { level: n, gridSize: 125, ...TUTORIAL[n - 1] };
  }

  // Past the designed list. Returning null lets callers show "more coming
  // soon" rather than silently inventing a level nobody has played.
  if (!ALLOW_PROCEDURAL_OVERFLOW) return null;

  // Level 20+: open-ended ramp, with a recognisable SHAPE every few levels.
  // Not every board needs to be something - a plain square reads as "a
  // puzzle", and a shape landing every 4th level reads as a reward. Shapes
  // also give the board a non-square silhouette, which is only possible
  // because cells outside the mask are labelled -1 and generateLinesData
  // already treats those as not-free.
  const over = n - TUTORIAL.length;

  if (over % 4 === 3) {
    const shape = SHAPE_ROTATION[Math.floor(over / 4) % SHAPE_ROTATION.length];
    return {
      level: n,
      gridSize: 125,
      shape, // shape wins; `region` is ignored when a mask is present
      k: Math.min(8, 3 + Math.floor(over / 6)),
      pattern: "blobs",
      straightness: Math.max(0.55, 0.8 - over * 0.01),
      seed: 1000 + n,
    };
  }

  return {
    level: n,
    gridSize: 125,
    region: Math.min(125, 40 + over * 4),
    k: Math.min(12, 5 + Math.floor(over / 3)),
    pattern: "blobs",
    straightness: Math.max(0.5, 0.7 - over * 0.01),
    seed: 1000 + n,
  };
}

// ---------------------------------------------------------------------------
// Daily puzzles
// ---------------------------------------------------------------------------

/**
 * Turn a YYYY-MM-DD string into a stable 32-bit seed.
 *
 * Every player who opens the app on the same local date gets the same board,
 * with no server, no download and no account. If you later want to CURATE
 * dailies - hand-pick a nice one, or run a themed week - fetch a recipe and
 * pass it to getDailyRecipe as an override. The offline path stays as the
 * fallback, so the game still works with no network.
 */
export function dateSeed(dateStr) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {string} dateStr YYYY-MM-DD, LOCAL date (see streakLogic)
 * @param {object} [override] server-supplied recipe, if you ever add one
 */
export function getDailyRecipe(dateStr, override) {
  if (override) return { ...override, date: dateStr };

  const seed = dateSeed(dateStr);
  // Vary the shape a little day to day so dailies don't feel identical, but
  // keep them all in "a solid, mid-hard board" territory.
  const k = 4 + (seed % 5); // 4..8
  const region = 70 + (seed % 40); // 70..109

  return {
    date: dateStr,
    level: null,
    region,
    k,
    pattern: "blobs",
    straightness: 0.65,
    seed,
    generatorVersion: GENERATOR_VERSION,
  };
}

export function isPhotoUnlocked(highestLevel) {
  return (highestLevel ?? 0) >= PHOTO_UNLOCK_LEVEL;
}