import { Skia } from "@shopify/react-native-skia";
import * as ImageManipulator from "expo-image-manipulator";

/**
 * Milestone 1: take a picture, convert it to gridSize x gridSize, and map
 * each coordinate in that resized image to a color for the game's grid
 * (the "gridPicture").
 *
 * Pipeline:
 *  1. Normalize the picked asset through expo-image-manipulator. Photo
 *     library picks can come back as a content:// uri (Android) or HEIC
 *     (iOS default photo format), either of which Skia's decoder can fail
 *     on; the camera always gives a plain JPEG file:// uri, which is why
 *     this only broke for library picks. Manipulator uses the OS's own
 *     image APIs to read any of those and hands back a guaranteed local
 *     JPEG, so Skia only ever has to decode one predictable format.
 *  2. Progressively halve the image toward gridSize using cubic-filtered
 *     draws (drawImageRectCubic), instead of one single huge-ratio
 *     downscale. A single pass from e.g. 4000px -> 125px is a ~32x
 *     reduction; any single-pass filter effectively just samples a few
 *     source pixels per destination cell at that ratio, which is what was
 *     producing noisy/aliased-looking results. Repeated 2x halving passes
 *     properly averages each 2x2 block at every step (closer to true
 *     mipmap-quality downsampling), which is what "blends" similar source
 *     colors together smoothly instead of aliasing.
 *  3. Read the raw RGBA pixel buffer back out of the final gridSize x
 *     gridSize surface.
 *
 * @param {string} uri - local file uri from expo-image-picker
 * @param {number} gridSize - target width/height in cells (Milestone 1: 125)
 * @returns {Promise<string[][]>} gridSize x gridSize array of "rgba(r,g,b,a)"
 *   strings, indexed as colors[row][col]
 */
export async function imageToGridColors(uri, gridSize = 125) {
  const normalized = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const data = await Skia.Data.fromURI(normalized.uri);
  if (!data) {
    throw new Error("imageToGridColors: could not read image data from uri");
  }

  let image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) {
    throw new Error("imageToGridColors: could not decode image");
  }

  // Mitchell filter (B=1/3, C=1/3): a good general-purpose resampler that
  // smooths without going as soft as a pure box/B-spline filter.
  const CUBIC_B = 1 / 3;
  const CUBIC_C = 1 / 3;

  let width = image.width();
  let height = image.height();

  while (width > gridSize * 2 && height > gridSize * 2) {
    const nextWidth = Math.max(gridSize, Math.floor(width / 2));
    const nextHeight = Math.max(gridSize, Math.floor(height / 2));

    const stepSurface = Skia.Surface.Make(nextWidth, nextHeight);
    if (!stepSurface) {
      throw new Error(
        "imageToGridColors: could not create downsample step surface",
      );
    }

    stepSurface
      .getCanvas()
      .drawImageRectCubic(
        image,
        Skia.XYWHRect(0, 0, width, height),
        Skia.XYWHRect(0, 0, nextWidth, nextHeight),
        CUBIC_B,
        CUBIC_C,
      );

    image = stepSurface.makeImageSnapshot();
    width = nextWidth;
    height = nextHeight;
  }

  const surface = Skia.Surface.Make(gridSize, gridSize);
  if (!surface) {
    throw new Error("imageToGridColors: could not create offscreen surface");
  }

  // Final pass: stretch whatever's left (already close to gridSize thanks to
  // the halving above) to exactly gridSize x gridSize. Stretching (not
  // cropping) so the whole photo is represented even off-square.
  surface
    .getCanvas()
    .drawImageRectCubic(
      image,
      Skia.XYWHRect(0, 0, width, height),
      Skia.XYWHRect(0, 0, gridSize, gridSize),
      CUBIC_B,
      CUBIC_C,
    );

  const snapshot = surface.makeImageSnapshot();
  // Surface.Make() defaults to unpremul RGBA_8888, so a plain readPixels()
  // call (no target ImageInfo) hands back that same Uint8Array layout.
  const pixels = snapshot.readPixels();

  if (!pixels) {
    throw new Error("imageToGridColors: readPixels returned no data");
  }

  const colors = Array.from({ length: gridSize }, () => new Array(gridSize));

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = (row * gridSize + col) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];
      const alpha = (a / 255).toFixed(3);
      colors[row][col] = `rgba(${r},${g},${b},${alpha})`;
    }
  }

  return colors;
}

// ---------------------------------------------------------------------------
// K-Means color quantization
// ---------------------------------------------------------------------------
//
// imageToGridColors() hands back one "rgba(r,g,b,a)" string per grid cell,
// straight from the photo - two visually-identical pixels are still almost
// never byte-identical. Milestone 2 (auto-generating arrows) needs cells to
// agree on an exact color to be grouped together, so this reduces the whole
// grid down to K representative colors via K-Means clustering in RGB space,
// then snaps every cell to its nearest cluster.

const DEFAULT_K = 32;
const BACKGROUND_ALPHA_THRESHOLD = 0.15;

const RGBA_RE =
  /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/;

function parseRGBA(str) {
  const m = RGBA_RE.exec(str ?? "");
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  };
}

// Small seeded PRNG (mulberry32) so quantization is deterministic run-to-run
// for the same photo, instead of depending on Math.random().
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sqDist(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

// K-Means++ initialization: pick spread-out starting centroids (weighted by
// distance to already-chosen ones) instead of pure random, so clusters land
// on genuinely distinct colors rather than clumping by chance.
function kMeansPlusPlusInit(points, k, rng) {
  const centroids = [points[Math.floor(rng() * points.length)]];
  const distSq = new Float64Array(points.length).fill(Infinity);

  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      const d = sqDist(points[i], last);
      if (d < distSq[i]) distSq[i] = d;
      total += distSq[i];
    }

    if (total === 0) {
      // All remaining points are identical to an existing centroid; just
      // fill the rest with (harmless) duplicates rather than looping forever.
      centroids.push(points[Math.floor(rng() * points.length)]);
      continue;
    }

    let threshold = rng() * total;
    let chosen = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      threshold -= distSq[i];
      if (threshold <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(points[chosen]);
  }

  return centroids;
}

/**
 * K-Means quantize a Milestone-1 color grid down to K representative colors.
 *
 * Background/near-transparent cells (alpha < alphaThreshold) are excluded
 * from clustering entirely and passed through unchanged - they're never
 * part of the game's playable region.
 *
 * @param {string[][]} colorGrid - gridSize x gridSize "rgba(r,g,b,a)" strings
 *   (Milestone 1's output).
 * @param {{k?: number, maxIterations?: number, seed?: number, alphaThreshold?: number}} [options]
 * @returns {{
 *   quantizedColorGrid: string[][],   // same shape as colorGrid, snapped to the palette
 *   labelGrid: number[][],            // cluster index per cell, -1 = background
 *   palette: {r:number,g:number,b:number}[], // the K cluster colors actually used
 * }}
 */
export function kMeansQuantizeColors(
  colorGrid,
  { k = DEFAULT_K, maxIterations = 15, seed = 42, alphaThreshold = BACKGROUND_ALPHA_THRESHOLD } = {},
) {
  const rows = colorGrid.length;
  const cols = rows > 0 ? colorGrid[0].length : 0;

  const points = [];
  const parsedGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const pointIndexGrid = Array.from({ length: rows }, () => new Array(cols).fill(-1));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const parsed = parseRGBA(colorGrid[row][col]);
      parsedGrid[row][col] = parsed;
      if (!parsed || parsed.a < alphaThreshold) continue;
      pointIndexGrid[row][col] = points.length;
      points.push(parsed);
    }
  }

  const labelGrid = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const quantizedColorGrid = Array.from({ length: rows }, () => new Array(cols));

  if (points.length === 0) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        quantizedColorGrid[row][col] = colorGrid[row][col];
      }
    }
    return { quantizedColorGrid, labelGrid, palette: [] };
  }

  const effectiveK = Math.min(k, points.length);
  const rng = mulberry32(seed);

  let centroids = kMeansPlusPlusInit(points, effectiveK, rng);
  const labels = new Int32Array(points.length);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign step: nearest centroid per point.
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let best = 0;
      let bestDist = Infinity;
      for (let ci = 0; ci < centroids.length; ci++) {
        const d = sqDist(p, centroids[ci]);
        if (d < bestDist) {
          bestDist = d;
          best = ci;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }

    if (!changed && iter > 0) break;

    // Update step: recompute each centroid as the mean of its assigned points.
    const sums = Array.from({ length: centroids.length }, () => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[labels[i]];
      s.r += points[i].r;
      s.g += points[i].g;
      s.b += points[i].b;
      s.count += 1;
    }

    centroids = centroids.map((prev, ci) => {
      const s = sums[ci];
      // A centroid with no points assigned keeps its previous position
      // rather than collapsing to (0,0,0), which would otherwise start
      // stealing points from real clusters on the next iteration.
      if (s.count === 0) return prev;
      return { r: s.r / s.count, g: s.g / s.count, b: s.b / s.count };
    });
  }

  const palette = centroids.map((c) => ({
    r: Math.round(c.r),
    g: Math.round(c.g),
    b: Math.round(c.b),
  }));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const pi = pointIndexGrid[row][col];
      if (pi === -1) {
        quantizedColorGrid[row][col] = colorGrid[row][col];
        continue;
      }
      const label = labels[pi];
      labelGrid[row][col] = label;
      const { r, g, b } = palette[label];
      const alpha = parsedGrid[row][col].a.toFixed(3);
      quantizedColorGrid[row][col] = `rgba(${r},${g},${b},${alpha})`;
    }
  }

  return { quantizedColorGrid, labelGrid, palette };
}