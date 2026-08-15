// Single source of truth for grid geometry. These were previously duplicated
// between app/play/index.jsx and app/components/SkiaLine.jsx, which meant a
// change to DOT_SPACING in one place silently desynced tap detection from
// rendering.

export const CANVAS_WIDTH = 2560;
export const CANVAS_HEIGHT = 2560;

// RESOLUTION.
//
// GRID_ROWS/COLS are derived from these, so DOT_SPACING is the single
// resolution knob: halving it QUADRUPLES the cells the photo is sampled at,
// without changing the canvas, the camera, or the memory footprint - the Skia
// surface is viewport-sized and the world is only coordinates.
//
// 2560 / 10 = 256, so a photo is now sampled at 65,536 cells instead of
// 15,625. Stroke, arrowhead and dot radius are all halved with it, so the
// board looks the same - just finer.
//
// Measured cost of the change (desktop; a phone is roughly 6x slower):
//   generation    ~480ms -> ~420ms   unchanged; never was the bottleneck
//   K-Means K=32   ~32ms -> ~216ms   the real added cost, once per photo
//   turn points     ~10k -> ~30k     the render cost; watch this one
export const DOT_SPACING = 10;
export const GRID_OFFSET_X = 40;
export const GRID_OFFSET_Y = 40;

export const GRID_ROWS = Math.ceil(CANVAS_HEIGHT / DOT_SPACING); // 125
export const GRID_COLS = Math.ceil(CANVAS_WIDTH / DOT_SPACING); // 125

export const HITBOX = 32;
export const DOT_RADIUS = 4; // < DOT_SPACING/2 so dots don't tile edge-to-edge
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
export const MAX_PROGRESS = 32; // 32 * 80 = 2560px, clears the full canvas
export const FORWARD_MS = 1000;
export const RETURN_MS = 500;

export const FORWARD_RATE = MAX_PROGRESS / FORWARD_MS; // progress units per ms

// 15 was masking a contrast problem: arrows are drawn in their own cluster's
// colour, so widening them was the only way to see them. Now that arrows are
// luminance-shifted away from their background (see arrowColor below), a
// thinner stroke reads better and leaves the dot grid legible underneath.
export const STROKE_WIDTH = 8;
export const BASE_OPACITY = 0.2;

// Arrowhead triangle, in local space, pointing along +x. Matches the old
// SVG path "M0 -6 L12 0 L0 6 Z".
export const ARROW_TRI = [0, -7, 7, 0, 0, 7]; // scaled with STROKE_WIDTH

// World extent in Skia coordinates. The Canvas is NO LONGER this size — it is
// viewport-sized, and this rectangle is mapped into it by a <Group transform>.
export const WORLD_WIDTH = CANVAS_WIDTH + 2 * GRID_OFFSET_X;
export const WORLD_HEIGHT = CANVAS_HEIGHT + 2 * GRID_OFFSET_Y;

export const MAX_SCALE = 0.8; // Change scale since the larger i zoom in the lagger it gets.

// How many tiles per axis the resting board is split into. Each tile is a
// separate Skia.Picture with a cull rect covering only its own area, which is
// what lets Skia quick-reject off-screen geometry when zoomed in.
//
// Higher = better culling when zoomed in, but more Pictures and more
// duplicated arrows at tile boundaries. 5 gives 25 tiles; at max zoom (5x)
// roughly 1-4 of them are visible.
// Each tile of a 5x5 grid would hold 4x the geometry at 256x256, undoing the
// culling win. More, smaller tiles keep per-tile weight roughly where it was.
export const TILES_PER_AXIS = 10;


// --- Collision sweep --------------------------------------------------------
// The arrowhead advances MAX_PROGRESS*SPEED/60 px per frame = ~2.1 cells at
// current tuning. Sampling only the head's endpoint therefore steps OVER
// intervening cells, which is exactly the "arrow passes through a blocker"
// bug. Sweeping at <= 1 cell means no cell in the travelled span is skipped.
export const SWEEP_STEP = DOT_SPACING * 0.5;

export const toCanvasX = (col) => GRID_OFFSET_X + col * DOT_SPACING;
export const toCanvasY = (row) => GRID_OFFSET_Y + row * DOT_SPACING;