// Procedural label grids - the same shape kMeansQuantizeColors produces, but
// generated from a seed instead of a photo.
//
// This is what lets levels exist without any level FILES. generateLinesData
// only ever sees a labelGrid; it does not care whether that grid came from a
// photograph or from a formula. So a level is fully described by a handful of
// numbers, and the puzzle is rebuilt identically on every device every time.
//
// SIZE WITHOUT TOUCHING THE RENDERER: the grid stays 125x125 always, because
// GRID_ROWS/GRID_COLS are derived from the canvas and changing them breaks
// everything downstream. Small levels are made by labelling only a centred
// REGION and marking every cell outside it as -1 (background), which
// generateLinesData already treats as not-free. A 10x10 level is a 125x125
// grid with a 10x10 island in the middle.

import {
  SHAPE_MASKS,
  placeMask,
  paletteToRgb,
  readShape,
} from "./shapeMasks";

const BACKGROUND = -1;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} opts
 * @param {number} opts.gridSize  full grid dimension (always 125 in the app)
 * @param {number} opts.region    playable square, centred. <= gridSize
 * @param {number} opts.k         how many clusters inside the region
 * @param {number} opts.seed
 * @param {"solid"|"blobs"|"bands"} opts.pattern
 * @param {string} [opts.shape]  key into SHAPE_MASKS. When present, the shape
 *                               decides WHICH cells are playable and `region`
 *                               is ignored - the mask's own size is the level
 *                               size, and its silhouette gives the board a
 *                               non-square outline.
 * @returns {{ labelGrid: number[][], palette: {r,g,b}[] }}
 */
export function makePatternGrid({
  gridSize = 125,
  region = 125,
  k = 4,
  seed = 1,
  pattern = "blobs",
  shape = null,
}) {
  const rng = mulberry32(seed);

  const mask = shape ? SHAPE_MASKS[shape] : null;
  if (shape && !mask) {
    console.warn(`[patternGrid] unknown shape "${shape}", falling back to square`);
  }

  // With a mask, the shape's own bounding box is the region and `shapeLabels`
  // carries the silhouette. Without one, the region is a centred square.
  const shapeLabels = mask ? placeMask(mask, gridSize) : null;
  const shapeInfo = mask ? readShape(mask) : null;

  // A COLOURED mask already contains its own labels and palette - the icon's
  // real colours. In that case there is nothing left to generate: return it
  // directly. This is what makes an apple come out red instead of whatever
  // hue the procedural palette happened to pick.
  if (shapeInfo?.palette) {
    return { labelGrid: shapeLabels, palette: paletteToRgb(shapeInfo.palette) };
  }

  const size = mask
    ? Math.max(shapeInfo.rows.length, shapeInfo.rows[0]?.length ?? 0)
    : Math.min(region, gridSize);
  const offset = Math.floor((gridSize - size) / 2);

  const labelGrid = Array.from({ length: gridSize }, () =>
    new Array(gridSize).fill(BACKGROUND),
  );

  const inShape = (gr, gc) => (shapeLabels ? shapeLabels[gr][gc] >= 0 : true);

  if (pattern === "solid" || k <= 1) {
    // One cluster filling the region. The simplest possible board: arrows can
    // travel anywhere inside it, so early levels stay readable.
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const gr = offset + r;
        const gc = offset + c;
        if (inShape(gr, gc)) labelGrid[gr][gc] = 0;
      }
    }
  } else if (pattern === "bands") {
    // Horizontal stripes. Boundaries are straight and predictable, which
    // makes the "one arrow, one colour" rule easy to see while learning.
    const bandHeight = Math.max(1, Math.floor(size / k));
    for (let r = 0; r < size; r++) {
      const label = Math.min(k - 1, Math.floor(r / bandHeight));
      for (let c = 0; c < size; c++) {
        const gr = offset + r;
        const gc = offset + c;
        if (inShape(gr, gc)) labelGrid[gr][gc] = label;
      }
    }
  } else {
    // Nearest-seed blobs with a little jitter - the same ragged, organic
    // region shapes K-Means finds in a real photo.
    const seeds = [];
    const seedCount = k * 3;
    for (let i = 0; i < seedCount; i++) {
      seeds.push({ r: rng() * size, c: rng() * size, l: i % k });
    }
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const jr = r + (rng() - 0.5) * 4;
        const jc = c + (rng() - 0.5) * 4;
        let best = Infinity;
        let label = 0;
        for (const s of seeds) {
          const d = (s.r - jr) ** 2 + (s.c - jc) ** 2;
          if (d < best) {
            best = d;
            label = s.l;
          }
        }
        const gr = offset + r;
        const gc = offset + c;
        if (inShape(gr, gc)) labelGrid[gr][gc] = label;
      }
    }
  }

  return { labelGrid, palette: makePalette(k, seed) };
}

/**
 * Evenly spaced hues at fixed saturation and lightness. Deterministic from the
 * seed, so a level's colours are as stable as its geometry.
 */
function makePalette(k, seed) {
  const rng = mulberry32(seed + 7777);
  const hueOffset = rng() * 360;
  const out = [];
  for (let i = 0; i < Math.max(1, k); i++) {
    out.push(hslToRgb((hueOffset + (360 * i) / Math.max(1, k)) % 360, 0.62, 0.52));
  }
  return out;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else[r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}