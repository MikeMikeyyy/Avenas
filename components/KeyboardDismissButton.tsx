// Floating "dismiss keyboard" button that hovers just above the keyboard on iOS.
// Mirrors the inline version used in create-custom-exercise / log-workout so the
// down-button looks and behaves identically across every text-entry screen.
// Drop it in as the last child of a screen's root View (a sibling of the scroll
// view); it positions itself absolutely and renders nothing when no keyboard is up.

import { useEffect, useState } from "react";
import { Keyboard, Platform, TouchableOpacity } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "../contexts/ThemeContext";

function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4" />
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function KeyboardDismissButton() {
  const { isDark } = useTheme();
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  if (kbHeight === 0 || Platform.OS !== "ios") return null;

  return (
    <TouchableOpacity
      onPress={() => Keyboard.dismiss()}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Dismiss keyboard"
      style={{
        position: "absolute",
        right: 10,
        bottom: kbHeight + 8,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 9,
        backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        zIndex: 999,
      }}
    >
      <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
    </TouchableOpacity>
  );
}
