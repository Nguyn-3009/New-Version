import { useState } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { imageToGridColors, kMeansQuantizeColors } from "../utils/imageToGrid";
import { generateLinesData } from "../utils/generateLines";
import {
  setGridColors,
  setGridQuantization,
  setGeneratedLines,
} from "../utils/gridImageStore";

const GRID_SIZE = 125; // 125x125 grid
const PALETTE_SIZE = 8; // K for K-Means color quantization

export default function PhotoScreen() {
  const router = useRouter();
  const [previewUri, setPreviewUri] = useState(null);
  const [processing, setProcessing] = useState(false);

  async function pickFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Camera access needed",
        "Enable camera access in Settings to take a photo.",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      quality: 1,
    });

    handlePickerResult(result);
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo library access needed",
        "Enable photo library access in Settings to choose a photo.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 1,
    });

    handlePickerResult(result);
  }

  function handlePickerResult(result) {
    if (result.canceled || !result.assets?.length) {
      return;
    }
    setPreviewUri(result.assets[0].uri);
  }

  async function useThisPhoto() {
    if (!previewUri) return;

    setProcessing(true);
    try {
      const rawColors = await imageToGridColors(previewUri, GRID_SIZE);
      const { quantizedColorGrid, labelGrid, palette } = kMeansQuantizeColors(
        rawColors,
        { k: PALETTE_SIZE },
      );
      setGridColors(quantizedColorGrid);
      setGridQuantization(labelGrid, palette);

      const { lines, blanks } = generateLinesData(labelGrid, palette);
      setGeneratedLines(lines, blanks);

      router.replace({
        pathname: "/play",
        params: { photoReady: Date.now().toString() },
      });
    } catch (err) {
      console.error("Failed to process photo:", err);
      Alert.alert(
        "Couldn't process that photo",
        "Please try a different photo.",
      );
    } finally {
      setProcessing(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Start from a photo</Text>
      <Text style={styles.subtitle}>
        We'll map its colors onto the grid ({GRID_SIZE}x{GRID_SIZE})
      </Text>

      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.preview} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No photo selected</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={pickFromCamera}>
          <Text style={styles.buttonText}>Take Photo</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={pickFromLibrary}>
          <Text style={styles.buttonText}>Choose from Library</Text>
        </Pressable>
      </View>

      <Pressable
        style={[
          styles.primaryButton,
          (!previewUri || processing) && styles.primaryButtonDisabled,
        ]}
        onPress={useThisPhoto}
        disabled={!previewUri || processing}
      >
        {processing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Use This Photo</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 24,
    backgroundColor: "#f5f5f5",
  },
  title: { fontSize: 24, fontWeight: "bold", color: "#222" },
  subtitle: { fontSize: 14, color: "#666", marginTop: 6, marginBottom: 24 },
  preview: {
    width: 240,
    height: 240,
    borderRadius: 12,
    marginBottom: 24,
    backgroundColor: "#ddd",
  },
  placeholder: {
    width: 240,
    height: 240,
    borderRadius: 12,
    marginBottom: 24,
    backgroundColor: "#e1dddd",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: { color: "#888" },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E24B4A",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  buttonText: { color: "#E24B4A", fontWeight: "600" },
  primaryButton: {
    backgroundColor: "#E24B4A",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    minWidth: 180,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    backgroundColor: "#e5a6a5",
  },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
