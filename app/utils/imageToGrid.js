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