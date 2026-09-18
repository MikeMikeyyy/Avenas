// Create a group, or manage an existing one.
//
// One screen for both: with no `id` param it creates (name + pick members),
// with an `id` it edits. A member who isn't the owner gets the same screen in
// read-only form — they can see who else is in the group but not change it,
// which matches what the RLS actually allows (owner-only membership writes).
//
// Anyone you're CONNECTED to can be a member — a client or a fellow trainer.
// Migration 0016's insert policy asks for an accepted connection and nothing
// else (it's role-blind, and 0027 kept it that way), so the picker is both
// buckets of the resolved roster merged, with local/mock entries filtered out.
// It was built from `clients` alone, which meant a trainer had to be taken on
// as a client before they could be put in a group, and a gym that ran on
// trainer-to-trainer groups couldn't make one at all.

import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../components/FadeScreen";
import NeuCard from "../../components/NeuCard";
import BounceButton from "../../components/BounceButton";
import Avatar from "../../components/Avatar";
import KeyboardDismissButton from "../../components/KeyboardDismissButton";
import ReportReasonSheet from "../../components/trainer/ReportReasonSheet";
import PeopleIcon from "../../components/icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { PILL_RADIUS } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { createGroup, fetchGroup, fetchGroupMembers, renameGroup, setGroupAvatar, setGroupMembers, uploadGroupAvatar } from "../../lib/groups";
import { getMyUid, isCloudContactId } from "../../lib/chat";
import { resolveTrainerRoster } from "../../utils/roster";
import { loadBlockedIds, reportPerson } from "../../utils/moderation";
import type { Client } from "../../utils/trainerStore";
import type { GroupMember } from "../../constants/groups";
import type { ReportReason } from "../../constants/chat";

export default function GroupEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const groupId = id ?? "";
  const isNew = !groupId;

  const [name, setName] = useState("");
  const [candidates, setCandidates] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isOwner, setIsOwner] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(null);
  /** The member whose report sheet is open (null = closed). */
  const [reportTarget, setReportTarget] = useState<GroupMember | null>(null);
  /** The group's saved photo, as loaded. `photoChange` is what the owner has
   *  staged on top of it — the upload only happens on Save, so backing out of
   *  this screen leaves the group exactly as it was. */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoChange, setPhotoChange] = useState<
    { type: "set"; uri: string; mimeType?: string } | { type: "remove" } | null
  >(null);

  const shownPhoto =
    photoChange?.type === "set" ? photoChange.uri
    : photoChange?.type === "remove" ? null
    : photoUrl;

  const submitReport = useCallback(async (reason: ReportReason) => {
    const target = reportTarget;
    setReportTarget(null);
    if (!target) return;
    await reportPerson({ id: target.id, name: target.name, photoUri: target.photoUri }, reason);
    Alert.alert(
      "Report received",
      "Thanks, we review reports within 24 hours and remove content, and the people who post it, that breaks our guidelines.",
    );
  }, [reportTarget]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getMyUid();
        // Every real connection is eligible: the DB only asks that we're
        // connected, so both roster buckets go in the picker. Someone in both
        // (a trainer you also coach) appears once, badged TRAINER either way.
        const [{ clients, trainers }, blocked] = await Promise.all([resolveTrainerRoster(), loadBlockedIds()]);
        const byId = new Map<string, Client>();
        for (const c of clients) {
          if (isCloudContactId(c.id) && !blocked.has(c.id)) byId.set(c.id, c);
        }
        for (const tr of trainers) {
          if (!isCloudContactId(tr.id) || blocked.has(tr.id)) continue;
          const already = byId.get(tr.id);
          byId.set(tr.id, already
            ? { ...already, isTrainer: true }
            : { id: tr.id, name: tr.name, initials: tr.initials, photoUri: tr.photoUri, isTrainer: true });
        }
        // Alphabetical: the two buckets arrive in their own orders, and a list
        // that changes order depending on which one someone came from reads as
        // random to the person scrolling it.
        const eligible = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
        if (cancelled) return;
        setCandidates(eligible);
        setMyUid(uid);

        if (groupId && uid) {
          const [g, roster] = await Promise.all([fetchGroup(uid, groupId), fetchGroupMembers(groupId)]);
          if (cancelled) return;
          if (!g) {
            Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
            router.back();
            return;
          }
          setName(g.name);
          setIsOwner(g.isOwner);
          setPhotoUrl(g.photoUri ?? null);
          setMembers(roster);
          // The owner is always a member; the picker only covers the others.
          setSelected(new Set(roster.filter(m => m.id !== uid).map(m => m.id)));
        }
      } catch (err) {
        if (__DEV__) console.warn("[avenas] load group edit", err);
        if (!cancelled) Alert.alert("Couldn't load", "Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, router]));

  const toggle = useCallback((clientId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }, []);

  // Pick from the library and STAGE it. The upload happens in onSave, which on a
  // NEW group is the only time it can: there's no group id to file the photo
  // under until create_group has returned one.
  const pickPhoto = useCallback(async () => {
    if (busy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Allow photo library access in Settings to choose a group photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotoChange({ type: "set", uri: asset.uri, mimeType: asset.mimeType });
  }, [busy]);

  const onPhotoPress = useCallback(() => {
    if (busy) return;
    if (shownPhoto) {
      Alert.alert("Group photo", undefined, [
        { text: "Change Photo", onPress: () => void pickPhoto() },
        {
          text: "Remove Photo",
          style: "destructive",
          onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPhotoChange({ type: "remove" }); },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      void pickPhoto();
    }
  }, [busy, shownPhoto, pickPhoto]);

  /** Commit a staged photo change against a group that now definitely exists.
   *  Failures here surface on their own: the group itself saved, and telling the
   *  owner "couldn't save group" for a photo that didn't upload would be a lie
   *  about what happened to the rest of it. */
  const commitPhoto = useCallback(async (id: string) => {
    if (!photoChange) return;
    if (photoChange.type === "set") {
      const url = await uploadGroupAvatar(id, photoChange.uri, photoChange.mimeType);
      await setGroupAvatar(id, url);
    } else {
      await setGroupAvatar(id, null);
    }
  }, [photoChange]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy;

  const ctaLabel = useMemo(() => {
    if (busy) return "Saving…";
    if (isNew) return selected.size > 0 ? `Create with ${selected.size} member${selected.size === 1 ? "" : "s"}` : "Create group";
    return "Save changes";
  }, [busy, isNew, selected.size]);

  const onSave = async () => {
    if (!canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(true);
    try {
      if (isNew) {
        const newId = await createGroup(trimmed, Array.from(selected));
        // The group exists either way from here: a photo that fails to upload is
        // reported on its own rather than taking the create down with it.
        try {
          await commitPhoto(newId);
        } catch (e) {
          Alert.alert("Group created", `The photo didn't upload: ${e instanceof Error ? e.message : "try again from the group's settings."}`);
        }
        router.replace({ pathname: "/trainer/group/[id]", params: { id: newId, name: trimmed } });
        return;
      }
      await renameGroup(groupId, trimmed);
      await setGroupMembers(groupId, Array.from(selected));
      await commitPhoto(groupId);
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save group", e instanceof Error ? e.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: t.div }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Go back" accessibilityRole="button">
          <View style={[styles.backBtn, { backgroundColor: t.ctrl }]}>
            <Ionicons name="chevron-back" size={22} color={t.tp} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.tp }]} numberOfLines={1}>
          {isNew ? "New Group" : isOwner ? "Manage Group" : "Group Members"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={ACCT} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        >
          {isOwner ? (
            <>
              {/* The photo sits above the name for the same reason it does on
                  the profile screen: it's the thing you recognise the group by
                  in a list, so it's the first thing you set. */}
              <View style={styles.photoBlock}>
                <TouchableOpacity
                  onPress={onPhotoPress}
                  activeOpacity={0.85}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={shownPhoto ? "Change group photo" : "Add group photo"}
                >
                  <NeuCard dark={isDark} radius={48} style={styles.photo}>
                    <View style={styles.photoInner}>
                      {shownPhoto
                        ? <Image source={{ uri: shownPhoto }} style={styles.photoImage} contentFit="cover" transition={150} />
                        : <PeopleIcon size={38} color={ACCT} />}
                    </View>
                  </NeuCard>
                  <View style={[styles.cameraBadge, { backgroundColor: ACCT, borderColor: t.bg }]}>
                    <Ionicons name="camera" size={16} color="#fff" />
                  </View>
                </TouchableOpacity>
                <Text style={[styles.photoNote, { color: t.ts }]}>
                  {photoChange
                    ? `Tap ${isNew ? "Create" : "Save changes"} to apply the photo`
                    : shownPhoto ? "Tap to change the group photo" : "Tap to add a group photo"}
                </Text>
              </View>

              <Text style={[styles.label, { color: t.ts }]}>GROUP NAME</Text>
              <NeuCard dark={isDark} radius={14}>
                <TextInput
                  style={[styles.input, { color: t.tp }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Monday Strength"
                  placeholderTextColor={t.ts}
                  maxLength={60}
                  returnKeyType="done"
                />
              </NeuCard>

              <Text style={[styles.label, { color: t.ts, marginTop: 24 }]}>
                {`MEMBERS (${selected.size})`}
              </Text>
              {candidates.length === 0 ? (
                <NeuCard dark={isDark} radius={16}>
                  <View style={styles.emptyInner}>
                    <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                      <PeopleIcon size={26} color={ACCT} />
                    </View>
                    <Text style={[styles.emptyTitle, { color: t.tp }]}>No connections yet</Text>
                    <Text style={[styles.emptyBody, { color: t.ts }]}>
                      {"A group can include anyone you're connected with, clients and trainers alike. Connect someone by code or QR first."}
                    </Text>
                  </View>
                </NeuCard>
              ) : (
                candidates.map(c => {
                  const checked = selected.has(c.id);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      activeOpacity={0.85}
                      style={{ marginBottom: 10 }}
                      onPress={() => toggle(c.id)}
                      accessibilityRole="button"
                      accessibilityState={{ checked }}
                      accessibilityLabel={`${checked ? "Remove" : "Add"} ${c.name}`}
                    >
                      <NeuCard dark={isDark} radius={14}>
                        <View style={styles.row}>
                          <Avatar
                            uri={c.photoUri}
                            initials={c.initials}
                            size={40}
                            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                            textColor={ACCT}
                            textStyle={[styles.avatarText, { color: ACCT }]}
                          />
                          <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                          {c.isTrainer && (
                            <View style={[styles.ownerTag, { backgroundColor: `${ACCT}22` }]}>
                              <Text style={[styles.ownerTagText, { color: ACCT }]}>TRAINER</Text>
                            </View>
                          )}
                          <View style={[styles.check, checked
                            ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6 }
                            : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)" },
                          ]}>
                            {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                          </View>
                        </View>
                      </NeuCard>
                    </TouchableOpacity>
                  );
                })
              )}

              <BounceButton style={{ marginTop: 22 }} onPress={canSave ? onSave : undefined} accessibilityLabel={ctaLabel}>
                <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT, opacity: canSave ? 1 : 0.4 }]}>
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                </View>
              </BounceButton>
            </>
          ) : (
            <>
              <Text style={[styles.readonlyName, { color: t.tp }]}>{name}</Text>
              <Text style={[styles.readonlyHint, { color: t.ts }]}>
                Only the trainer who created this group can change its name or members.
              </Text>
              {members.map(m => (
                <NeuCard key={m.id} dark={isDark} radius={14} style={{ marginBottom: 10 }}>
                  <View style={styles.row}>
                    <Avatar
                      uri={m.photoUri}
                      initials={m.initials}
                      size={40}
                      backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                      textColor={ACCT}
                      textStyle={[styles.avatarText, { color: ACCT }]}
                    />
                    <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{m.name}</Text>
                    {m.isOwner && (
                      <View style={[styles.ownerTag, { backgroundColor: `${ACCT}22` }]}>
                        <Text style={[styles.ownerTagText, { color: ACCT }]}>TRAINER</Text>
                      </View>
                    )}
                    {/* Group members see each other's names and photos without
                        being connected, so this is the only place they can
                        report one (Apple Guideline 1.2). */}
                    {m.id !== myUid && (
                      <TouchableOpacity
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReportTarget(m); }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Report ${m.name}`}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color={t.ts} />
                      </TouchableOpacity>
                    )}
                  </View>
                </NeuCard>
              ))}
            </>
          )}
        </ScrollView>
      )}

      <ReportReasonSheet
        visible={reportTarget !== null}
        title={`Report ${reportTarget?.name ?? "member"}`}
        onSubmit={submitReport}
        onClose={() => setReportTarget(null)}
      />

      <KeyboardDismissButton />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  headerTitle:  { flex: 1, fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center" },
  loading:      { flex: 1, alignItems: "center", justifyContent: "center" },

  label:        { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },
  input:        { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 14, paddingHorizontal: 16 },

  // Same geometry as the profile screen's photo picker, so setting a group's
  // photo and setting your own look and behave identically.
  photoBlock:   { alignItems: "center", gap: 10, marginBottom: 24 },
  photo:        { width: 96, height: 96, borderRadius: 48 },
  photoInner:   { width: 96, height: 96, alignItems: "center", justifyContent: "center", borderRadius: 48, overflow: "hidden" },
  photoImage:   { width: 96, height: 96, borderRadius: 48 },
  cameraBadge:  { position: "absolute", bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  photoNote:    { fontFamily: FontFamily.regular, fontSize: 12 },

  row:          { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowTitle:     { flex: 1, fontFamily: FontFamily.semibold, fontSize: 15 },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 14 },
  check:        { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  ownerTag:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ownerTagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },

  emptyInner:   { padding: 24, alignItems: "center", gap: 10 },
  emptyIcon:    { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },

  cta:          { borderRadius: PILL_RADIUS, paddingVertical: 15, alignItems: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },

  readonlyName: { fontFamily: FontFamily.bold, fontSize: 22, marginBottom: 6 },
  readonlyHint: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, marginBottom: 18 },
});
