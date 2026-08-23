// The one place a puzzle gets built and handed to the play screen.
//
// Before this, the play screen only ever received photo puzzles, and it read
// them straight out of gridImageStore. Levels and dailies need the same
// handoff, so everything now goes through here and the store carries a small
// piece of METADATA saying where the puzzle came from.
//
// That metadata is what lets the play screen behave differently per source
// without knowing anything about levels: it reports completion for a level,
// and stays quiet for a photo.

import { generateLinesData } from "./generateLines";
import { getLevelRecipe, getDailyRecipe } from "./levelRecipes";
import { makePatternGrid } from "./patternGrid";
import { setGeneratedLines, setPuzzleMeta } from "./gridImageStore";

/**
 * Build a puzzle from a recipe and put it in the store.
 * Synchronous and fast - no image decoding, no network - so it can run
 * directly from a button press without a loading screen.
 */
export function loadPuzzleFromRecipe(recipe, meta) {
  const { labelGrid, palette } = makePatternGrid({
    gridSize: 125,
    region: recipe.region ?? 125,
    k: recipe.k ?? 4,
    seed: recipe.seed ?? 1,
    pattern: recipe.pattern ?? "blobs",
    shape: recipe.shape ?? null,
  });

  const { lines, blanks } = generateLinesData(labelGrid, palette, {
    seed: recipe.seed ?? 1,
    straightness: recipe.straightness ?? 0.75,
    // RULE 4. Omitted from a recipe means singles are allowed, which is the
    // long-standing behaviour, so existing levels and dailies are unchanged.
    allowSingleCellArrows: recipe.allowSingleCellArrows ?? true,
  });

  setPuzzleMeta(meta);
  setGeneratedLines(lines, blanks); // bumps puzzleVersion -> play screen reloads

  return lines.length;
}

export function loadLevel(level) {
  const recipe = getLevelRecipe(level);
  return loadPuzzleFromRecipe(recipe, { source: "level", level });
}

export function loadDaily(dateStr, override) {
  const recipe = getDailyRecipe(dateStr, override);
  return loadPuzzleFromRecipe(recipe, { source: "daily", date: dateStr });
}