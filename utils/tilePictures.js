// The resting board's tile Pictures, held in shared values.
//
// WHY THIS EXISTS
//
// Same reason as the flight pool: every React commit inside <Canvas> makes RN
// Skia stop the Reanimated mapper, re-visit the whole scene graph and start a
// new mapper (sksg/HostConfig.js resetAfterCommit -> Container.redraw()).
//
// The flight pool removed the commits that came from mounting and unmounting
// arrows. This removes the other half: the tiles themselves. They used to live
// in useState, so re-recording one after a launch or a landing meant a
// setTiles -> new array -> commit -> full pipeline teardown, right in the
// middle of the animation the re-record existed to support.
//
// A Picture prop accepts a SharedValue (its type is SkiaProps<PictureProps>),
// and an SkPicture is a jsi::HostObject, which Reanimated passes across
// threads BY REFERENCE rather than copying - see cloneHostObject in
// react-native-worklets/serializable.js. So a tile can be recorded on the JS
// thread exactly as before and then simply ASSIGNED here. That fires the
// existing mapper (applyUpdates + play) instead of rebuilding it: no commit,
// no tree re-visit, no mapper restart.
//
// Recording still happens on the JS thread on purpose. It is the same work
// recordOneTile always did, and doing it in a worklet would move it onto the
// thread that draws frames - which is the one thing this is trying to protect.

import { Skia } from "@shopify/react-native-skia";
import { makeMutable } from "react-native-reanimated";

import { TILES_PER_AXIS } from "./gridConfig";
import { recordAllTiles, recordOneTile } from "./restingTiles";

export const TILE_COUNT = TILES_PER_AXIS * TILES_PER_AXIS;

// Stable node indices. Module scope so the array identity never changes and
// the Picture nodes never remount.
export const TILE_SLOTS = Array.from({ length: TILE_COUNT }, (_, i) => i);

// drawPicture (sksg/Recorder/commands/Drawing.js) hands its prop straight to
// canvas.drawPicture with no null check, so an empty tile still has to be a
// real picture. A 1x1 cull rect is quick-rejected before anything is replayed.
//
// Safe at module scope: @shopify/react-native-skia's index.js runs
// `import "./skia/NativeSetup"` on its first line, so the API is live as soon
// as anything imports the package.
const EMPTY_PICTURE = (() => {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return recorder.finishRecordingAsPicture();
})();

// One shared value per tile. Every tile always has a valid picture, so the
// Canvas can render all TILE_COUNT nodes from the very first frame, before any
// puzzle has been recorded.
export const TILE_PICTURES = TILE_SLOTS.map(() => makeMutable(EMPTY_PICTURE));

/**
 * Re-record the whole board. Called when the puzzle itself changes.
 *
 * The assignments land in one batch: Reanimated flushes dirty mappers once per
 * frame, so publishing all TILE_COUNT tiles costs a single pipeline update
 * rather than one per tile.
 */
export function publishAllTiles(compiled, tileIndex, flyingIds, escapedIds) {
  const recorded = recordAllTiles(compiled, tileIndex, flyingIds, escapedIds);
  const byKey = new Map(recorded.map((t) => [t.key, t.picture]));
  for (let t = 0; t < TILE_COUNT; t++) {
    TILE_PICTURES[t].value = byKey.get(t) ?? EMPTY_PICTURE;
  }
}

/** Re-record just these tiles. `indices` is tileIndex.lineTiles[i]. */
export function publishTiles(indices, compiled, tileIndex, flyingIds, escapedIds) {
  for (let n = 0; n < indices.length; n++) {
    const t = indices[n];
    const rebuilt = recordOneTile(compiled, t, tileIndex, flyingIds, escapedIds);
    TILE_PICTURES[t].value = rebuilt ? rebuilt.picture : EMPTY_PICTURE;
  }
}
