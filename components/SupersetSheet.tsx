// Superset With for a card with no sheet of its own (Log Workout's, whose
// changes are a panel on the card; user request, 2026-11-15). In none, it opens
// on the pick (components/SupersetPickStep.tsx, the exercise sheets' own step);
// in one, it says who with and offers Add to Superset and Remove from
// Superset, as the Workout tab's sheet does (utils/supersets.ts).
//
// What's picked happens once the sheet has slid away, so its words never
// change under it as it goes.

import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import SimpleSheet from "./trainer/SimpleSheet";
import SheetPill from "./SheetPill";
import SupersetPickStep, { namesList, type SupersetChoice } from "./SupersetPickStep";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

export default function SupersetSheet({ visible, onClose, name, choices, partners, onJoin, onLeave }: {
  visible: boolean;
  onClose: () => void;
  /** The exercise it's opened for. */
  name: string;
  /** What it can be put in a superset with (utils/supersets.ts supersetChoicesFor). */
  choices: readonly SupersetChoice[];
  /** Its superset's other members, by name; none when it's in none. */
  partners: readonly string[];
  /** Joins the one picked to its superset. */
  onJoin: (key: string) => void;
  onLeave: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Each opening starts on the pick when it's in none, else on what it's in.
  const [step, setStep] = useState<"in" | "pick">(partners.length > 0 ? "in" : "pick");
  const [shownFor, setShownFor] = useState(visible);
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) setStep(partners.length > 0 ? "in" : "pick");
  }

  // What runs once the sheet has slid away: after its close.
  const after = useRef<(() => void) | null>(null);
  const handleClose = useCallback(() => {
    const next = after.current;
    after.current = null;
    onClose();
    next?.();
  }, [onClose]);

  return (
    <SimpleSheet visible={visible} onClose={handleClose}>
      {close => {
        const leave = (then: () => void) => { after.current = then; close(); };
        if (step === "pick") {
          return (
            <SupersetPickStep
              name={name}
              choices={choices}
              onPick={key => leave(() => onJoin(key))}
              onCancel={() => (partners.length > 0 ? setStep("in") : close())}
            />
          );
        }
        return (
          <View style={styles.body}>
            <View style={styles.head}>
              <Text style={[styles.title, { color: t.tp }]}>Superset</Text>
              <Text style={[styles.message, { color: t.ts }]}>
                {`${name} is in a superset with ${namesList(partners)}.`}
              </Text>
            </View>
            <SheetPill
              label="Add to Superset"
              icon={c => <Ionicons name="link-outline" size={18} color={c} />}
              onPress={() => setStep("pick")}
            />
            <SheetPill
              label="Remove from Superset"
              icon={c => <Ionicons name="unlink-outline" size={18} color={c} />}
              onPress={() => leave(onLeave)}
            />
            <SheetPill label="Cancel" variant="cancel" onPress={close} />
          </View>
        );
      }}
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  // As components/SupersetPickStep.tsx's.
  body:    { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  head:    { alignItems: "center", gap: 6, paddingHorizontal: 4, paddingBottom: 4 },
  title:   { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center" },
  message: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 8 },
});
