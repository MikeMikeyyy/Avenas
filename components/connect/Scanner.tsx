// Full-screen QR scanner used by the Connect screen. Wraps expo-camera's
// CameraView (works in Expo Go), handles the permission prompt, and fires
// onScanned once with the raw scanned string (the Connect screen parses the
// code out of it). The `handled` guard stops the rapid repeat callbacks
// CameraView emits while a code stays in frame.

import { useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import GlassButton, { GLASS } from "../GlassButton";
import { BACK_LEFT, BACK_TOP } from "../BackButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

/** The close button: a size up from the page's round buttons, over a camera. */
const CLOSE_SIZE = 44;

export default function Scanner({
  onScanned,
  onClose,
}: {
  onScanned: (raw: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <View style={styles.root}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current) return;
            handled.current = true;
            onScanned(data);
          }}
        />
      ) : (
        <View style={styles.permWrap}>
          <Ionicons name="camera-outline" size={44} color="#fff" />
          <Text style={styles.permText}>
            {permission && !permission.canAskAgain
              ? "Camera access is off. Enable it in Settings to scan a code."
              : "Allow camera access to scan a connect code."}
          </Text>
          {(!permission || permission.canAskAgain) && (
            <TouchableOpacity style={styles.permBtn} onPress={() => void requestPermission()} activeOpacity={0.85}>
              <Text style={styles.permBtnText}>Allow Camera</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {permission?.granted && (
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>Point at a connect QR code</Text>
        </View>
      )}

      {/* Glass in the app's light or dark on iOS 26, so its ✕ is the page's
          ink; the solid one is a dark disc over the camera, its ✕ white. */}
      <GlassButton
        onPress={onClose}
        size={CLOSE_SIZE}
        style={[styles.closeFloat, { top: insets.top + BACK_TOP }]}
        solidStyle={styles.closeSolid}
        accessibilityLabel="Close scanner"
      >
        <Ionicons name="close" size={26} color={GLASS ? t.tp : "#fff"} />
      </GlassButton>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { ...StyleSheet.absoluteFill, backgroundColor: "#000", zIndex: 50 },
  permWrap:    { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 16 },
  permText:    { fontFamily: FontFamily.regular, fontSize: 15, color: "#fff", textAlign: "center", lineHeight: 21 },
  permBtn:     { backgroundColor: ACCT, borderRadius: 50, paddingVertical: 13, paddingHorizontal: 28 },
  permBtnText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  overlay:     { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 20 },
  frame:       { width: 230, height: 230, borderRadius: 28, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" },
  hint:        { fontFamily: FontFamily.semibold, fontSize: 15, color: "#fff" },
  closeFloat:  { position: "absolute", right: BACK_LEFT },
  closeSolid:  { backgroundColor: "rgba(0,0,0,0.5)" },
});
