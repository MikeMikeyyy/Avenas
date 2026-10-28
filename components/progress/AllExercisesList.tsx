// components/progress/AllExercisesList.tsx
//
// Exercise Progress under "All programs" (user request and decisions,
// 2026-10-26): every exercise logged, from any program, day or custom workout,
// once each, in one card per muscle group that opens to its exercises
// (utils/allExercises.ts), and a round search button on the heading that opens
// a search field over all of them. A tap on an exercise charts every session
// of it, by date (ProgressView). It replaced one card per program opening to
// its days, which showed one program's exercises at a time.
//
// The search is the page's: it keeps the field clear of the keyboard, and the
// keyboard's down key closes it, as on a group's member search.

import { useMemo, type ReactNode, type Ref } from "react";
import { View, Text, StyleSheet, type TextInputInstance, type ViewInstance } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Reanimated, { FadeIn, FadeOut } from "react-native-reanimated";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import GlassButton from "../GlassButton";
import SearchField from "../SearchField";
import DumbbellIcon from "../DumbbellIcon";
import { ExercisePill, ExpandablePanel, RotatingChevron } from "../DayExerciseList";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import type { CustomExercise } from "../../constants/exercises";
import type { LoggedExerciseRow } from "../../constants/progress";
import { exerciseIdentity, sameExercise, type ExerciseRef } from "../../utils/exerciseNames";
import { isDeletedExercise } from "../../utils/customExercises";
import { groupByMuscle, searchLoggedExercises, type MuscleGroupRows } from "../../utils/allExercises";

/** The heading's round search button: the Trainer tab's section buttons. */
const SEARCH_BTN = 36;
/** The heading's line (DayExerciseList's title), which the button centres on. */
const TITLE_LINE = 24;

interface Props {
  /** Every exercise logged (utils/progressStats.ts collectLoggedExercises). */
  rows: LoggedExerciseRow[];
  /** Every custom exercise the rows can be (knownCustomExercises), deleted ones
   *  included: each one's muscles, and whether it was deleted. */
  customExercises: CustomExercise[];
  /** The exercise being charted, or null. */
  selected: ExerciseRef | null;
  onSelect: (ex: ExerciseRef) => void;
  /** The muscle group open (its label), or null. Held by the page, which
   *  remembers it between visits (utils/progressSession.ts). */
  expandedMuscle: string | null;
  onExpandedMuscleChange: (label: string | null) => void;
  searchOpen: boolean;
  query: string;
  onQueryChange: (text: string) => void;
  onToggleSearch: () => void;
  searchInputRef: Ref<TextInputInstance>;
  /** The heading's row: the page lifts it to the top of the screen while the
   *  search is typed in, so the matches show above the keyboard. */
  headingRef: Ref<ViewInstance>;
}

export default function AllExercisesList({
  rows,
  customExercises,
  selected,
  onSelect,
  expandedMuscle,
  onExpandedMuscleChange,
  searchOpen,
  query,
  onQueryChange,
  onToggleSearch,
  searchInputRef,
  headingRef,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const groups = useMemo(() => groupByMuscle(rows, customExercises), [rows, customExercises]);
  // Typed in: one list of what matches, closest first, in place of the groups.
  const matches = useMemo(
    () => (searchOpen ? searchLoggedExercises(rows, query, customExercises) : null),
    [searchOpen, rows, query, customExercises],
  );

  const pill = (r: LoggedExerciseRow, i: number) => (
    <ExercisePill
      key={`${exerciseIdentity(r)}-${i}`}
      row={r}
      deleted={isDeletedExercise(r, customExercises)}
      selected={sameExercise(r, selected)}
      onPress={() => onSelect(r)}
    />
  );

  return (
    <View style={styles.section}>
      <View ref={headingRef} collapsable={false}>
        <Text style={[styles.sectionTitle, { color: t.tp }]}>Exercise Progress</Text>
        {rows.length > 0 ? (
          <GlassButton
            onPress={onToggleSearch}
            size={SEARCH_BTN}
            solidStyle={PILL_SHADOW}
            style={styles.searchBtn}
            accessibilityLabel={searchOpen ? "Close search" : "Search exercises"}
          >
            <Ionicons name={searchOpen ? "close" : "search"} size={18} color={t.tp} />
          </GlassButton>
        ) : null}
      </View>

      {searchOpen ? (
        <Reanimated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.searchRow}>
          <SearchField
            inputRef={searchInputRef}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search exercises"
            autoFocus
          />
        </Reanimated.View>
      ) : null}

      {rows.length === 0 ? (
        <NeuCard dark={isDark} radius={20}>
          <View style={styles.empty}>
            <DumbbellIcon size={28} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>No exercises logged yet.</Text>
          </View>
        </NeuCard>
      ) : matches ? (
        matches.length > 0 ? (
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.matches}>{matches.map(pill)}</View>
          </NeuCard>
        ) : (
          <Text style={[styles.noMatch, { color: t.ts }]}>No exercises match</Text>
        )
      ) : (
        groups.map((g, i) => (
          <MuscleCard
            key={g.label}
            group={g}
            first={i === 0}
            open={expandedMuscle === g.label}
            onToggle={() => onExpandedMuscleChange(expandedMuscle === g.label ? null : g.label)}
            renderPill={pill}
          />
        ))
      )}
    </View>
  );
}

/** One muscle group: its name and how many exercises, opening to them. */
function MuscleCard({
  group,
  first,
  open,
  onToggle,
  renderPill,
}: {
  group: MuscleGroupRows;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  renderPill: (r: LoggedExerciseRow, i: number) => ReactNode;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const n = group.rows.length;
  const sub = `${n} exercise${n === 1 ? "" : "s"}`;
  return (
    <View style={{ marginTop: first ? 0 : 12 }}>
      <NeuCard dark={isDark} radius={20}>
        <BounceButton
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${group.label}, ${sub}`}
        >
          <View style={styles.groupRow}>
            <View style={styles.groupNameCol}>
              <Text style={[styles.groupName, { color: t.tp }]} numberOfLines={1}>{group.label}</Text>
              <Text style={[styles.groupSub, { color: t.ts }]} numberOfLines={1}>{sub}</Text>
            </View>
            <RotatingChevron color={t.ts} rotated={open} />
          </View>
        </BounceButton>

        <ExpandablePanel expanded={open}>
          <View style={[styles.groupBody, { borderTopColor: t.div }]}>{group.rows.map(renderPill)}</View>
        </ExpandablePanel>
      </NeuCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 20, marginTop: 36 },
  // As DayExerciseList's, so the heading doesn't move between scopes.
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 18, lineHeight: TITLE_LINE, marginBottom: 12 },
  // Out of the flow and centred on the title's line, so the heading stands
  // where it does for one program. In points (CLAUDE.md).
  searchBtn: { position: "absolute", right: 0, top: (TITLE_LINE - SEARCH_BTN) / 2 },
  searchRow: { marginBottom: 12 },
  noMatch: { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },

  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  groupNameCol: { flex: 1 },
  groupName: { fontFamily: FontFamily.bold, fontSize: 17 },
  groupSub: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  // Padding on all sides leaves the pills' shadows room inside the panel's
  // clipped height.
  groupBody: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  matches: { padding: 16, gap: 10 },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
