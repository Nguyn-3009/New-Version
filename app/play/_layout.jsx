import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View, Alert } from "react-native";

export default function PlayLayout() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const handleRestart = () => {
    Alert.alert("Restart Game", "Reset everything and start fresh?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Restart",
        style: "destructive",
        onPress: () => {
          router.replace({
            pathname: "/play",
            params: { restart: Date.now().toString() },
          });
        },
      },
    ]);
  };

  // Pull the logged past tab path, default back to Home ("/") if undefined
  const targetBackPath = params.previousTab || "/";

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Play",
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => router.replace(targetBackPath)}
              // hitSlop pads out the tap area up to 20 pixels around the button for easier clicking
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            >
              {/* Shift caret slightly left to visually center arrow inside circle */}
              <View>
                <Ionicons name="caret-back" size={30} color="black" />
              </View>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleRestart} style={{ marginRight: 15 }}>
              <Ionicons name="refresh-circle" size={28} color="#E24B4A" />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
