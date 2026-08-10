// Shape masks for level boards.
//
// A shape comes in two flavours:
//
//  1. SILHOUETTE - an array of strings using "#" and ".". Shape only; the
//     level's `pattern` decides the colours.
//
//  2. COLOURED  - { palette: ["#c1272d", ...], rows: ["..001..", ...] } where
//     each character is an index into the palette and "." is background. The
//     icon's OWN colours come through, so an apple is red, a leaf is green.
//     This is what tools/mask-maker.html produces.
//
// Both are plain text: readable, diff-able, and hand-editable. You can fix a
// stray pixel in a text editor without regenerating anything.
//
// Produced by tools/mask-maker.html: drop in an icon PNG, tune the whiteness
// and alpha cutoffs until the silhouette reads, copy the output here.
//
// WHY MASKS RATHER THAN IMAGES AT RUNTIME:
//  - no image decoding on the device, so a level loads instantly
//  - deterministic; no dependence on Skia's decoder or on a file being
//    present, which means a level can never fail to load
//  - a 40x40 mask is ~1.6 KB of text, small enough to ship dozens
//
// The mask says WHERE the board is. The pattern (blobs/bands) says what
// COLOUR each cell inside it gets. Shape and palette are independent.

const BACKGROUND = -1;

// A small starter set, generated from formulas so the pipeline is testable
// before you add real icons. Replace or extend with mask-maker output.
export const SHAPE_MASKS = {
  flash: {
    palette: ["#000000", "#888888", "#888888", "#888888", "#888888", "#888888", "#888888", "#888888"],
    rows: [{
      rows: [
        "............................................................",
        "............................................................",
        ".........................0000000000............0............",
        ".....................000000000000000000......00.............",
        "...................0000000000000000000000...000.............",
        ".................00000000000000000000000000000..............",
        "...............0000000000000000000000000000.00..............",
        "..............0000000000000000000000000000..000.............",
        "............00000000000000000000000000000..00000............",
        "...........00000000000000000000000000000...000000...........",
        "..........00000000000000000000000000000...00000000..........",
        ".........00000000000000000000000000000....000000000.........",
        "........00000000000000000000000000000....00000000000........",
        ".......00000000000000000000000000000....0000000000000.......",
        ".......0000000000000000000000000000....00000000000000.......",
        "......0000000000000000000000000000.....000000000000000......",
        "......000000000000000000000000000.....0000000000000000......",
        ".....000000000000000000000000000......00000000000000000.....",
        ".....00000000000000000000000000......000000000000000000.....",
        "....00000000000000000000000000......00000000000000000000....",
        "....0000000000000000000000000........0000000000000000000....",
        "...0000000000000000000000000..............000000000000000...",
        "...000000000000000000000000..............0000000000000000...",
        "...00000000000000000000000..............00000000000000000...",
        "...0000000000000000000000...............00000000000000000...",
        "..0000000000000000000000...............0000000000000000000..",
        "..00000000000000000000000000000.......00000000000000000000..",
        "..00000000000000000000000000000......000000000000000000000..",
        "..0000000000000000000000000000......0000000000000000000000..",
        "..000000000000000000000000000.......0000000000000000000000..",
        "..00000000000000000000000000.......00000000000000000000000..",
        "..00000000000000000000000000......000000000000000000000000..",
        "..0000000000000000000000000......0000000000000000000000000..",
        "..000000000000000000000000.......0000000000000000000000000..",
        "..00000000000000000000000.............00000000000000000000..",
        "...000000000000000000000.............000000000000000000000..",
        "...00000000000000000000.............000000000000000000000...",
        "...00000000000000000000............0000000000000000000000...",
        "...0000000000000000000............00000000000000000000000...",
        "....000000000000000000000........00000000000000000000000....",
        "....0000000000000000000000......000000000000000000000000....",
        ".....000000000000000000000.....000000000000000000000000.....",
        ".....00000000000000000000.....0000000000000000000000000.....",
        "......000000000000000000.....0000000000000000000000000......",
        "......000000000000000000....00000000000000000000000000......",
        ".......0000000000000000....00000000000000000000000000.......",
        "........00000000000000....000000000000000000000000000.......",
        "........00000000000000...000000000000000000000000000........",
        ".........000000000000...000000000000000000000000000.........",
        "..........00000000000..000000000000000000000000000..........",
        "...........000000000..000000000000000000000000000...........",
        "............0000000..000000000000000000000000000............",
        ".............00000..000000000000000000000000000.............",
        "...............000.00000000000000000000000000...............",
        ".................00000000000000000000000000.................",
        "................00.0000000000000000000000...................",
        "...............00....000000000000000000.....................",
        "...............0........000000000000........................",
        "............................................................",
        "............................................................",
      ],
    }]
  },

  heart: buildFromFn(28, (x, y) => {
    // Implicit heart curve, sampled on the grid.
    const px = (x - 13.5) / 12;
    const py = -(y - 15) / 12;
    const a = px * px + py * py - 0.6;
    return a * a * a - px * px * py * py * py <= 0;
  }),

  ring: buildFromFn(32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5);
    return d <= 15 && d >= 8.5;
  }),

  cross: buildFromFn(30, (x, y) => {
    const inX = x >= 11 && x <= 18;
    const inY = y >= 11 && y <= 18;
    return inX || inY;
  }),

  diamond: buildFromFn(30, (x, y) => Math.abs(x - 14.5) + Math.abs(y - 14.5) <= 14),
};

function buildFromFn(size, fn) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) row += fn(x, y) ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

/**
 * True where the mask is solid. Bounds-safe, so callers don't have to check.
 */
const CH = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Normalise either flavour into { rows, palette|null }. */
export function readShape(shape) {
  if (Array.isArray(shape)) return { rows: shape, palette: null };
  return { rows: shape.rows, palette: shape.palette ?? null };
}

/**
 * Label at a mask cell, or -1 for background.
 * Silhouettes report label 0 everywhere they are solid; the caller decides
 * what colour that becomes.
 */
export function maskLabelAt(rows, r, c) {
  const row = rows[r];
  if (!row) return BACKGROUND;
  const ch = row[c];
  if (ch === undefined || ch === ".") return BACKGROUND;
  if (ch === "#") return 0;
  const idx = CH.indexOf(ch);
  return idx < 0 ? BACKGROUND : idx;
}

export function maskSize(rows) {
  return { rows: rows.length, cols: rows[0]?.length ?? 0 };
}

function hexToRgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if (!m) return { r: 136, g: 136, b: 136 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

export function paletteToRgb(palette) {
  return palette.map(hexToRgb);
}

/**
 * Place a mask centred inside a full-size grid, returning a boolean map of
 * which cells are playable.
 *
 * The mask is drawn at 1:1 - one mask cell is one grid cell - so mask size IS
 * level size. A 40x40 mask on the 125x125 grid leaves everything outside it
 * as BACKGROUND, which generateLinesData already treats as not-free.
 */
export function placeMask(shape, gridSize) {
  const { rows: maskRows } = readShape(shape);
  const { rows, cols } = maskSize(maskRows);
  const offR = Math.floor((gridSize - rows) / 2);
  const offC = Math.floor((gridSize - cols) / 2);

  // Label per grid cell, BACKGROUND outside the shape.
  const labels = Array.from({ length: gridSize }, () =>
    new Array(gridSize).fill(BACKGROUND),
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gr = offR + r;
      const gc = offC + c;
      if (gr < 0 || gr >= gridSize || gc < 0 || gc >= gridSize) continue;
      labels[gr][gc] = maskLabelAt(maskRows, r, c);
    }
  }

  return labels;
}

export const BACKGROUND_LABEL = BACKGROUND;