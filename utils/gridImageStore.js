// Small plain-JS handoff store between the photo screen and the play screen.
//
// This intentionally isn't a shared value / makeMutable — it's never touched
// from a worklet, only from plain JS (the photo screen writes it once after
// processing, the play screen reads it once on mount/param-change). A route
// param is used to tell the play screen *when* to read it, since a 125x125
// color grid is far too large to pass through router params directly.

let gridColors = null;
let gridLabels = null; // per-cell cluster index from kMeansQuantizeColors, -1 = background
let gridPalette = null; // the K {r,g,b} cluster colors actually used
let generatedLines = null; // output of generateLinesData: [{id,color,points}, ...]
let generatedBlanks = null; // cells generateLinesData couldn't assign to any line

export function setGridColors(colors) {
  gridColors = colors;
}

export function getGridColors() {
  return gridColors;
}

// labelGrid/palette are the extra output of kMeansQuantizeColors() - stashed
// alongside gridColors so a later step (grouping same-color cells into
// arrows) can look cells up by cluster index instead of re-parsing color
// strings.
export function setGridQuantization(labels, palette) {
  gridLabels = labels;
  gridPalette = palette;
}

export function getGridLabels() {
  return gridLabels;
}

export function getGridPalette() {
  return gridPalette;
}

// generateLinesData()'s output - the actual gameplay LINES data for
// play/index.jsx to build its trigger grid from, replacing the static
// LINE_TRIGGER.js data for a photo-generated puzzle.
// Bumped every time a new puzzle is stored. The play screen compares this
// against what it last rendered, so "is there a new puzzle?" is answered by
// the store itself rather than by a router param.
//
// The old design sent the DATA through this store and the SIGNAL through
// router params (photoReady: Date.now()). Two channels with different
// lifetimes: if the play screen was already mounted and the param didn't
// re-propagate through the nested Stack, you got a fresh puzzle in the store
// and a stale one on screen - and Restart appeared to "fix" it, because
// Restart reloads straight from the store.
let puzzleVersion = 0;

export function getPuzzleVersion() {
  return puzzleVersion;
}

export function setGeneratedLines(lines, blanks) {
  puzzleVersion += 1;
  generatedLines = lines;
  generatedBlanks = blanks;
}

export function getGeneratedLines() {
  return generatedLines;
}

export function getGeneratedBlanks() {
  return generatedBlanks;
}

export function clearGridColors() {
  gridColors = null;
  gridLabels = null;
  gridPalette = null;
  generatedLines = null;
  generatedBlanks = null;
}