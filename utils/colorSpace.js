// sRGB <-> CIELAB conversion.
//
// WHY: K-Means measures distance with Pythagoras. In RGB space that distance
// means nothing perceptually - the channels are weighted equally, but human
// vision is far more sensitive to green than to blue. Two greens 30 units
// apart look obviously different; two blues 30 units apart look nearly
// identical. So RGB clustering wastes clusters splitting hairs in blue while
// merging greens a person would call distinct.
//
// CIELAB is built so that Euclidean distance approximates perceived
// difference (this is the CIE76 dE metric). Cluster there and the palette
// matches what the eye would have picked.
//
// L = lightness 0..100, a = green->red, b = blue->yellow (both roughly -128..127)

// D65 reference white, the illuminant sRGB is defined against.
const XN = 95.047;
const YN = 100.0;
const ZN = 108.883;

/** sRGB gamma -> linear light. The 0.04045 knee is part of the sRGB spec. */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

const DELTA = 6 / 29;

function labF(t) {
  return t > DELTA * DELTA * DELTA
    ? Math.cbrt(t)
    : t / (3 * DELTA * DELTA) + 4 / 29;
}

function labFInv(t) {
  return t > DELTA ? t * t * t : 3 * DELTA * DELTA * (t - 4 / 29);
}

/** {r,g,b} 0..255 -> {L,a,b} */
export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);

  // Linear sRGB -> CIE XYZ (D65), scaled to 0..100.
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) * 100;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) * 100;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) * 100;

  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** {L,a,b} -> {r,g,b} 0..255, clamped to the sRGB gamut. */
export function labToRgb(L, a, bb) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;

  const x = (XN * labFInv(fx)) / 100;
  const y = (YN * labFInv(fy)) / 100;
  const z = (ZN * labFInv(fz)) / 100;

  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) };
}