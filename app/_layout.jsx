import { Tabs, useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useEffect } from "react";

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  // Keep track of the last tab the user actually viewed
  const lastActiveTab = useRef("/");

  // Monitor path changes to save the history before they enter the play stack
  useEffect(() => {
    if (pathname !== "/play") {
      lastActiveTab.current = pathname;
    }
  }, [pathname]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#E24B4A",
        tabBarInactiveTintColor: "gray",
        tabBarStyle: {
          height: 80,
          paddingTop: 8,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="streak"
        options={{
          tabBarLabel: "Streak",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="flame" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="play"
        options={{
          tabBarLabel: "Play",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="game-controller" size={size} color={color} />
          ),
          tabBarStyle: { display: "none" },
        }}
        // FIX: Intercept the click event to preserve history
        listeners={{
          tabPress: (e) => {
            e.preventDefault(); // Prevent standard tab jump
            // Push to play route, passing the previous route as a search parameter
            router.push({
              pathname: "/play",
              params: { previousTab: lastActiveTab.current },
            });
          },
        }}
      />

      <Tabs.Screen name="photo" options={{ href: null }} />
      <Tabs.Screen name="levels" options={{ href: null }} />
    </Tabs>
  );
}
