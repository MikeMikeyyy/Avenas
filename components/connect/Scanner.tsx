// Full-screen QR scanner used by the Connect screen. Wraps expo-camera's
// CameraView (works in Expo Go), handles the permission prompt, and fires
// onScanned once with the raw scanned string (the Connect screen parses the
// code out of it). The `handled` guard stops the rapid repeat callbacks
// CameraView emits while a code stays in frame.

import { useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { ACCT, FontFamily } from "../../constants/theme";

export default function Scanner({
  onScanned,
  onClose,
}: {
  onScanned: (raw: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

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

      <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Close scanner">
        <Ionicons name="close" size={26} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { ...StyleSheet.absoluteFillObject, backgroundColor: "#000", zIndex: 50 },
  permWrap:    { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 16 },
  permText:    { fontFamily: FontFamily.regular, fontSize: 15, color: "#fff", textAlign: "center", lineHeight: 21 },
  permBtn:     { backgroundColor: ACCT, borderRadius: 50, paddingVertical: 13, paddingHorizontal: 28 },
  permBtnText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  overlay:     { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 20 },
  frame:       { width: 230, height: 230, borderRadius: 28, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" },
  hint:        { fontFamily: FontFamily.semibold, fontSize: 15, color: "#fff" },
  closeBtn:    { position: "absolute", top: 56, right: 22, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
});
