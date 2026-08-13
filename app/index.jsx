import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import {
  highestUnlocked,
  loadLevelProgress,
  subscribe,
} from "../utils/levelProgress";
import { loadLevel, loadDaily } from "../utils/puzzleLoader";
import { LEVEL_COUNT, PHOTO_UNLOCK_LEVEL } from "../utils/levelRecipes";
import { localDateString } from "../utils/streakLogic";

export default function HomeScreen() {
  const router = useRouter();
  const [next, setNext] = useState(1);

  useEffect(() => {
    // Clamp to what exists, so "Continue" can't point past the last level.
    const clamp = () => setNext(Math.min(highestUnlocked(), LEVEL_COUNT));
    loadLevelProgress().then(clamp);
    return subscribe(clamp);
  }, []);

  const allDone = next >= LEVEL_COUNT && highestUnlocked() > LEVEL_COUNT;

  const photoUnlocked = next >= PHOTO_UNLOCK_LEVEL;

  const play = (level) => {
    loadLevel(level);
    router.push({ pathname: "/play", params: { previousTab: "/" } });
  };

  const playDaily = () => {
    loadDaily(localDateString());
    router.push({ pathname: "/play", params: { previousTab: "/" } });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Line Dash</Text>
      <Text style={styles.tagline}>Free every arrow</Text>

      <Pressable
        onPress={() => play(next)}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>
          {allDone
            ? "Replay · Level " + LEVEL_COUNT
            : next === 1
              ? "Start"
              : `Continue · Level ${next}`}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/levels")}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Ionicons name="grid-outline" size={19} color="#333" />
        <Text style={styles.secondaryLabel}>All Levels</Text>
      </Pressable>

      <Pressable
        onPress={playDaily}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Ionicons name="calendar-outline" size={19} color="#333" />
        <Text style={styles.secondaryLabel}>Daily Puzzle</Text>
      </Pressable>

      <Pressable
        onPress={() => photoUnlocked && router.push("/photo")}
        disabled={!photoUnlocked}
        style={({ pressed }) => [
          styles.secondary,
          !photoUnlocked && styles.locked,
          pressed && photoUnlocked && styles.pressed,
        ]}
      >
        <Ionicons
          name={photoUnlocked ? "image-outline" : "lock-closed"}
          size={19}
          color={photoUnlocked ? "#333" : "#b0ada5"}
        />
        <Text
          style={[styles.secondaryLabel, !photoUnlocked && styles.lockedLabel]}
        >
          {photoUnlocked
            ? "Photo Puzzle"
            : `Photo Puzzle · Level ${PHOTO_UNLOCK_LEVEL}`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  brand: { fontSize: 40, fontWeight: "800", color: "#222", letterSpacing: -1 },
  tagline: { fontSize: 15, color: "#888", marginTop: 4, marginBottom: 40 },
  primary: {
    backgroundColor: "#E24B4A",
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#e3e0d9",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    marginBottom: 10,
  },
  secondaryLabel: { fontSize: 16, fontWeight: "600", color: "#333" },
  locked: { backgroundColor: "#efeee9" },
  lockedLabel: { color: "#b0ada5" },
  pressed: { opacity: 0.65 },
});
