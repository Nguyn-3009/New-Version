import { View, Text, StyleSheet } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Line Dash</Text>
      <Text style={styles.subtitle}>Clear lines • Build streaks</Text>
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
});
