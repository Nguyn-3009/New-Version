// Single source of truth for grid geometry. These were previously duplicated
// between app/play/index.jsx and app/components/SkiaLine.jsx, which meant a
// change to DOT_SPACING in one place silently desynced tap detection from
// rendering.

export const CANVAS_WIDTH = 200;
export const CANVAS_HEIGHT = 200;

export const DOT_SPACING = 20;
export const GRID_OFFSET_X = 40;
export const GRID_OFFSET_Y = 40;

export const GRID_ROWS = Math.ceil(CANVAS_HEIGHT / DOT_SPACING); // 125
export const GRID_COLS = Math.ceil(CANVAS_WIDTH / DOT_SPACING); // 125

export const HITBOX = 48;
export const DOT_RADIUS = 10;
export const DEFAULT_DOT_COLOR = "#766e6e";

// --- Animation tuning -------------------------------------------------------
// SPEED / MAX_PROGRESS / FORWARD_MS reproduce the old SkiaLine numbers exactly:
// withTiming(10, {duration: 1000}) with headLen = progress * 80 + totalLength,
// i.e. the arrow travels 10 * 80 = 800 canvas px in one second.
//
// NOTE: 800px is only 40 grid cells. `isThrough` scans the escape ray all the
// way to the canvas edge (up to 125 cells), so a line whose blocker sits more
// than 40 cells away will fly its full 800px and stop dead without ever
// bouncing. Raising MAX_PROGRESS to ~32 makes the travel distance cover the
// full 2500px canvas. Left at 10 for now so behaviour matches what you already
// tested.
export const SPEED = 80;
export const MAX_PROGRESS = 10;
export const FORWARD_MS = 1000;
export const RETURN_MS = 500;

export const FORWARD_RATE = MAX_PROGRESS / FORWARD_MS; // progress units per ms

export const STROKE_WIDTH = 3;
export const BASE_OPACITY = 0.2;

// Arrowhead triangle, in local space, pointing along +x. Matches the old
// SVG path "M0 -6 L12 0 L0 6 Z".
export const ARROW_TRI = [0, -6, 12, 0, 0, 6];

export const toCanvasX = (col) => GRID_OFFSET_X + col * DOT_SPACING;
export const toCanvasY = (row) => GRID_OFFSET_Y + row * DOT_SPACING;