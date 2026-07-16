import { View, Text, StyleSheet } from "react-native";

export default function StreakScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.fire}>🔥</Text>
      <Text style={styles.streakNumber}>7</Text>
      <Text style={styles.text}>Day Streak</Text>
      <Text style={styles.sub}>Play daily to keep it going!</Text>
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
  fire: { fontSize: 80 },
  streakNumber: {
    fontSize: 72,
    fontWeight: "bold",
    color: "#E24B4A",
    marginVertical: 10,
  },
  text: { fontSize: 24, fontWeight: "600" },
  sub: { marginTop: 20, fontSize: 16, color: "#666" },
});
