import { Skia } from "@shopify/react-native-skia";

/**
 * Milestone 1: take a picture, convert it to gridSize x gridSize, and map
 * each coordinate in that resized image to a color for the game's grid
 * (the "gridPicture").
 *
 * Approach: decode the picked photo with Skia, draw it stretched to fill an
 * offscreen gridSize x gridSize Skia Surface (so the whole photo is used,
 * aspect ratio isn't preserved), then read the raw RGBA pixel buffer back
 * out. This avoids pulling in a separate native pixel-access library since
 * react-native-skia is already a project dependency.
 *
 * @param {string} uri - local file uri from expo-image-picker
 * @param {number} gridSize - target width/height in cells (Milestone 1: 125)
 * @returns {Promise<string[][]>} gridSize x gridSize array of "rgba(r,g,b,a)"
 *   strings, indexed as colors[row][col]
 */
export async function imageToGridColors(uri, gridSize = 125) {
  const data = await Skia.Data.fromURI(uri);
  if (!data) {
    throw new Error("imageToGridColors: could not read image data from uri");
  }

  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) {
    throw new Error("imageToGridColors: could not decode image");
  }

  const surface = Skia.Surface.Make(gridSize, gridSize);
  if (!surface) {
    throw new Error("imageToGridColors: could not create offscreen surface");
  }

  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  // Cubic sampling gives a smoother downscale from full photo -> 125x125
  // than nearest/bilinear, which matters a lot at this scale factor.
  paint.setAntiAlias(true);

  // Stretch the full source image to fill the grid exactly (no cropping),
  // so the whole photo is represented even if its aspect ratio isn't square.
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, gridSize, gridSize),
    paint,
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