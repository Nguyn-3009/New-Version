// Small plain-JS handoff store between the photo screen and the play screen.
//
// This intentionally isn't a shared value / makeMutable — it's never touched
// from a worklet, only from plain JS (the photo screen writes it once after
// processing, the play screen reads it once on mount/param-change). A route
// param is used to tell the play screen *when* to read it, since a 125x125
// color grid is far too large to pass through router params directly.

let gridColors = null;

export function setGridColors(colors) {
  gridColors = colors;
}

export function getGridColors() {
  return gridColors;
}

export function clearGridColors() {
  gridColors = null;
}