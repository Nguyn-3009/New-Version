import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Line Dash</Text>
      <Text style={styles.subtitle}>Clear lines • Build streaks</Text>

      <Pressable
        style={styles.photoButton}
        onPress={() => router.push("/photo")}
      >
        <Text style={styles.photoButtonText}>Start from a Photo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  title: { fontSize: 32, fontWeight: "bold", color: "#E24B4A" },
  subtitle: { fontSize: 18, marginTop: 10, color: "#555" },
  photoButton: {
    marginTop: 32,
    backgroundColor: "#E24B4A",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  photoButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
