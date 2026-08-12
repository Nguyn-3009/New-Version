import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import {
  highestUnlocked,
  isCleared,
  isUnlocked,
  loadLevelProgress,
  resetLevelProgress,
  subscribe,
} from "../utils/levelProgress";
import { loadLevel } from "../utils/puzzleLoader";
import {
  LEVEL_COUNT,
  PHOTO_UNLOCK_LEVEL,
  getLevelRecipe,
} from "../utils/levelRecipes";

// Draw exactly the levels that exist. A hardcoded count drew cells for
// levels the recipe table doesn't define, which the procedural fall-through
// then happily generated.
const LEVELS_SHOWN = LEVEL_COUNT;

export default function LevelsScreen() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLevelProgress().then(() => alive && setReady(true));
    // Re-render when a level is cleared while this screen is mounted.
    return subscribe(() => alive && setReady((v) => !v || true));
  }, []);

  const open = useCallback(
    (level) => {
      if (!isUnlocked(level)) return;
      // Build the puzzle BEFORE navigating. It's synchronous and fast - no
      // image decoding - so there's no loading state to manage.
      loadLevel(level);
      router.push({ pathname: "/play", params: { previousTab: "/levels" } });
    },
    [router],
  );

  if (!ready) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#E24B4A" />
      </View>
    );
  }

  const unlocked = highestUnlocked();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Levels</Text>
      <Text style={styles.sub}>
        {unlocked > PHOTO_UNLOCK_LEVEL
          ? "Photo mode unlocked — turn any picture into a puzzle."
          : `Clear level ${PHOTO_UNLOCK_LEVEL} to unlock photo mode`}
      </Text>

      {__DEV__ && (
        <Pressable
          onPress={resetLevelProgress}
          style={({ pressed }) => [styles.reset, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.resetLabel}>Reset progress (dev only)</Text>
        </Pressable>
      )}

      <View style={styles.grid}>
        {Array.from({ length: LEVELS_SHOWN }, (_, i) => i + 1).map((level) => {
          const cleared = isCleared(level);
          const open_ = isUnlocked(level);
          const isNext = level === unlocked;
          const recipe = getLevelRecipe(level);
          if (!recipe) return null;

          return (
            <Pressable
              key={level}
              onPress={() => open(level)}
              disabled={!open_}
              style={({ pressed }) => [
                styles.cell,
                cleared && styles.cellCleared,
                isNext && styles.cellNext,
                !open_ && styles.cellLocked,
                pressed && open_ && styles.cellPressed,
              ]}
            >
              {!open_ ? (
                <Ionicons name="lock-closed" size={18} color="#b9b6ae" />
              ) : (
                <>
                  <Text style={[styles.num, cleared && styles.numCleared]}>
                    {level}
                  </Text>
                  {cleared && (
                    <Ionicons
                      name="checkmark"
                      size={13}
                      color="#fff"
                      style={styles.tick}
                    />
                  )}
                  {recipe.shape && !cleared && <View style={styles.shapeDot} />}
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { justifyContent: "center", alignItems: "center" },
  content: { padding: 20, paddingTop: 70, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: "700", color: "#222" },
  sub: { fontSize: 13, color: "#777", marginTop: 6, marginBottom: 22 },
  // __DEV__ is false in release builds, so this never ships. Progress lives in
  // AsyncStorage - device storage - so reloading the bundle does NOT clear it.
  // That is the whole point of it, and also why levels you cleared while
  // testing stay unlocked across reloads.
  reset: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#d9d5cc",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  resetLabel: { fontSize: 12, color: "#999" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#e3e0d9",
    alignItems: "center",
    justifyContent: "center",
  },
  cellCleared: { backgroundColor: "#E24B4A", borderColor: "#E24B4A" },
  cellNext: { borderColor: "#E24B4A", borderWidth: 2.5 },
  cellLocked: { backgroundColor: "#efeee9", borderColor: "#e3e0d9" },
  cellPressed: { opacity: 0.6 },
  num: { fontSize: 18, fontWeight: "700", color: "#333" },
  numCleared: { color: "#fff" },
  tick: { position: "absolute", bottom: 6 },
  shapeDot: {
    position: "absolute",
    bottom: 8,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#E24B4A",
  },
});
