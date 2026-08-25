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
import { GRID_ROWS } from "../utils/gridConfig";
import { imageToGridColors, kMeansQuantizeColors } from "../utils/imageToGrid";
import { generateLinesData } from "../utils/generateLines";
import { despeckleLabels, recolorFromLabels } from "../utils/despeckle";
import {
  setGridColors,
  setGridQuantization,
  setGeneratedLines,
} from "../utils/gridImageStore";

// Resolution comes from gridConfig, NOT a local constant. These were two
// independent 125s before, which is how CANVAS_WIDTH=200 once produced a
// labelGrid addressing rows the trigger grid didn't have.
const GRID_SIZE = GRID_ROWS;
const PALETTE_SIZE = 8; // Number of colors for K-Means color quantization

// Dissolve any same-cluster region smaller than this before generating arrows.
// 2 means lone cells only - the case that is provably unfixable later, and the
// one that dominates. Measured on representative boards it cuts 1-cell arrows
// from 38-62% of all arrows down to 6-27%, for 2-15% of cells recoloured to
// their perceptually nearest neighbour. Raising it to 3 or 4 recolours more for
// almost no further gain. 0 disables the pass.
const DESPECKLE_MIN_REGION = 2;

export default function PhotoScreen() {
  const router = useRouter();
  const [previewUri, setPreviewUri] = useState(null);
  const [processing, setProcessing] = useState(false);

  // Crop vs whole image.
  //
  // "Whole" stretches the entire photo into the square grid - every pixel is
  // represented, but a landscape subject gets squashed and each face lands on
  // a handful of cells. "Crop" lets the player frame one subject, which is
  // the case the grid resolution actually handles well.
  const [cropMode, setCropMode] = useState(true);

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
      allowsEditing: cropMode,
      aspect: [1, 1],
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
      allowsEditing: cropMode,
      aspect: [1, 1],
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
      // Dissolve lone cells before generating arrows. K-Means speckle is where
      // 80-91% of 1-cell arrows came from, and a cell with no same-cluster
      // neighbour can never become anything else - see utils/despeckle.js.
      // Set DESPECKLE_MIN_REGION to 0 to turn this off.
      const despeckled = despeckleLabels(labelGrid, palette, {
        minRegionSize: DESPECKLE_MIN_REGION,
      });
      // Keep the dot picture agreeing with the arrows about every cell.
      const cleanColors = recolorFromLabels(
        quantizedColorGrid,
        despeckled.labelGrid,
        palette,
      );

      setGridColors(cleanColors);
      setGridQuantization(despeckled.labelGrid, palette);

      const { lines, blanks } = generateLinesData(despeckled.labelGrid, palette);
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

      <View style={styles.segment}>
        {[
          { key: true, label: "Crop to subject" },
          { key: false, label: "Whole image" },
        ].map((opt) => (
          <Pressable
            key={String(opt.key)}
            onPress={() => setCropMode(opt.key)}
            style={[styles.segItem, cropMode === opt.key && styles.segItemOn]}
          >
            <Text
              style={[
                styles.segLabel,
                cropMode === opt.key && styles.segLabelOn,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.segHint}>
        {cropMode
          ? "Frame one subject — a face reads far better than a whole scene."
          : "The full photo is squeezed into the square grid."}
      </Text>

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
  segment: {
    flexDirection: "row",
    alignSelf: "stretch",
    backgroundColor: "#eceae4",
    borderRadius: 10,
    padding: 3,
    marginTop: 18,
  },
  segItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
  },
  segItemOn: { backgroundColor: "#fff" },
  segLabel: { fontSize: 14, color: "#8a877f", fontWeight: "600" },
  segLabelOn: { color: "#222" },
  segHint: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
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