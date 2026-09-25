// The app's on/off switch: RN's native Switch at full size in the app's
// colours, and nothing else, so it keeps iOS's own look.
//
// Every switch draws this (Settings, Notifications, Privacy & Security, Create
// Exercise, and SheetToggle in a sheet). Each page used to set its own colours,
// and three of them used t.div for the off track in light mode, which is too
// pale against a white card to read as a control (see SWITCH_TRACK_LIGHT), so
// the same switch looked different depending on the page.

import { Switch, type SwitchProps } from "react-native";
import { ACCT, APP_DARK, SWITCH_TRACK_LIGHT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

type Props = Omit<SwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor">;

export default function AppSwitch(props: Props) {
  const { isDark } = useTheme();
  return (
    <Switch
      {...props}
      trackColor={{ false: isDark ? APP_DARK.div : SWITCH_TRACK_LIGHT, true: ACCT }}
      thumbColor="#fff"
    />
  );
}
