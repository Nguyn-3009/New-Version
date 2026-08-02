// Arrow colours.
//
// generateLinesData assigns each arrow `palette[label]` — the exact colour of
// the dots it sits on. That's correct as data (the arrow belongs to that
// cluster) but invisible as rendering: every arrow is camouflaged against its
// own background by construction. It only looked fine in the static demo
// because those dots were grey and the lines red.
//
// Fix: keep the hue, push the luminance apart. Dark clusters get a lightened
// arrow, light clusters get a darkened one, so an arrow always reads against
// whatever it crosses while still looking like it belongs to its region.

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
const RGBA = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

function parseColor(c) {
  if (typeof c !== "string") return null;

  const hex = HEX.exec(c.trim());
  if (hex) {
    return [
      parseInt(hex[1], 16),
      parseInt(hex[2], 16),
      parseInt(hex[3], 16),
    ];
  }

  const rgba = RGBA.exec(c);
  if (rgba) {
    return [
      Math.round(parseFloat(rgba[1])),
      Math.round(parseFloat(rgba[2])),
      Math.round(parseFloat(rgba[3])),
    ];
  }

  return null;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

const toHex = (r, g, b) =>
  `#${clamp255(r).toString(16).padStart(2, "0")}${clamp255(g)
    .toString(16)
    .padStart(2, "0")}${clamp255(b).toString(16).padStart(2, "0")}`;

/** Rec. 709 relative luminance, 0..1. */
export function luminance(rgb) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/**
 * Derive a visible arrow colour from its cluster's colour.
 *
 * @param {string} bg      the cluster colour the arrow sits on
 * @param {number} amount  0..1, how far to push luminance apart
 */
export function arrowColor(bg, amount = 0.55) {
  const rgb = parseColor(bg);
  if (!rgb) return bg;

  const lum = luminance(rgb);

  // Push away from mid-grey: dark backgrounds get a lighter arrow and vice
  // versa. Mixing toward white/black rather than scaling keeps the hue.
  if (lum < 0.5) {
    return toHex(
      rgb[0] + (255 - rgb[0]) * amount,
      rgb[1] + (255 - rgb[1]) * amount,
      rgb[2] + (255 - rgb[2]) * amount,
    );
  }
  return toHex(
    rgb[0] * (1 - amount),
    rgb[1] * (1 - amount),
    rgb[2] * (1 - amount),
  );
}

/** Map a whole palette at once, preserving index alignment with labelGrid. */
export function arrowPalette(palette, amount) {
  return palette.map((c) => arrowColor(c, amount));
}