// Create a group, or manage an existing one.
//
// One screen for both: with no `id` param it creates (name + pick members),
// with an `id` it edits. A member who isn't the owner gets the same screen in
// read-only form — they can see who else is in the group but not change it,
// which matches what the RLS actually allows (owner-only membership writes).
//
// That form is the group's member list ("View members" in the group page's ⋯
// menu): a search from the button opposite Back, and each person opening the
// group page's own sheet (components/trainer/GroupMemberSheet.tsx), with
// Add to favourites and Report (user request, 2026-10-29: a flag on each row
// reported them). The owner's form ("Manage group") ends with Delete group,
// which used to sit in that ⋯ menu.
//
// Anyone you're CONNECTED to can be a member — a client or a fellow trainer.
// Migration 0016's insert policy asks for an accepted connection and nothing
// else (it's role-blind, and 0027 kept it that way), so the picker is both
// buckets of the resolved roster merged, with local/mock entries filtered out.
// It was built from `clients` alone, which meant a trainer had to be taken on
// as a client before they could be put in a group, and a gym that ran on
// trainer-to-trainer groups couldn't make one at all.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Keyboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
  type TextInputInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../constants/floatingBars";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../components/FadeScreen";
import NeuCard from "../../components/NeuCard";
import BounceButton from "../../components/BounceButton";
import GlassButton from "../../components/GlassButton";
import Avatar from "../../components/Avatar";
import KeyboardDismissButton from "../../components/KeyboardDismissButton";
import SearchField from "../../components/SearchField";
import FavouriteStar from "../../components/FavouriteStar";
import GroupMemberSheet from "../../components/trainer/GroupMemberSheet";
import PeopleIcon from "../../components/icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER_BRIGHT, ON_FILL } from "../../constants/theme";
import { darkGlow, glowOpacity, haloGlow, PILL_RADIUS } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { useAccountType } from "../../contexts/AccountTypeContext";
import { useAuth } from "../../contexts/AuthContext";
import { createGroup, deleteGroup, fetchGroup, fetchGroupMembers, isGroupFullError, isGroupLimitError, renameGroup, setGroupAvatar, setGroupMembers, uploadGroupAvatar } from "../../lib/groups";
import { getMyUid, isCloudContactId } from "../../lib/chat";
import { AVATAR_PHOTO, pickSquarePhoto } from "../../lib/photoPicker";
import { resolveTrainerRoster } from "../../utils/roster";
import { loadBlockedIds } from "../../utils/moderation";
import { loadFavouriteMemberIds, sortByFavourite, toggleFavouriteMember } from "../../utils/groupStore";
import { dropGroupPage, peekGroupPage } from "../../utils/groupPage";
import type { Client } from "../../utils/trainerStore";
import { GROUP_FULL_MESSAGE, GROUP_FULL_TITLE, GROUP_LIMIT_TITLE, MAX_GROUP_MEMBERS, canCoachGroup, groupLimitMessage, type GroupMember } from "../../constants/groups";
import { alertMessage } from "../../utils/errors";
import BackButton, { BACK_SIZE, BACK_TOP, BACK_LEFT } from "../../components/BackButton";

export default function GroupEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const { accountType } = useAccountType();
  // The account the group page's saved copy belongs to (utils/pageSnapshot.ts).
  const { userId } = useAuth();

  const groupId = id ?? "";
  const isNew = !groupId;

  const [name, setName] = useState("");
  /** The name as saved, for the delete prompt: the field may hold an edit. */
  const [savedName, setSavedName] = useState("");
  const [candidates, setCandidates] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<GroupMember[]>([]);
  /** Members listed in the picker who are no longer connections. */
  const [notConnected, setNotConnected] = useState<Set<string>>(new Set());
  // Known before the load from the group page's copy (that page was open a
  // moment ago, and a group's owner never changes), so a member's list opens
  // as "Group Members" rather than "Manage Group" until the load lands.
  const [isOwner, setIsOwner] = useState(() => peekGroupPage(userId ?? "", groupId)?.group?.isOwner ?? true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Delete group is on its way to the server. */
  const [deleting, setDeleting] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(null);
  /** The member whose sheet is open (null = closed). */
  const [memberMenu, setMemberMenu] = useState<GroupMember | null>(null);
  /** People I've starred, oldest first (account-wide), and my clients: what a
   *  member's sheet shows, as on the group page. */
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [clientIds, setClientIds] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getMyUid();
        // Every real connection is eligible: the DB only asks that we're
        // connected, so both roster buckets go in the picker. Someone in both
        // (a trainer you also coach) appears once, badged TRAINER either way.
        const [{ clients, trainers }, blocked, favs] = await Promise.all([resolveTrainerRoster(), loadBlockedIds(), loadFavouriteMemberIds()]);
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
        if (cancelled) return;
        setMyUid(uid);
        setFavourites(favs);
        setClientIds(new Set(clients.map(c => c.id)));

        let roster: GroupMember[] = [];
        if (groupId && uid) {
          const [g, r] = await Promise.all([fetchGroup(uid, groupId), fetchGroupMembers(groupId)]);
          if (cancelled) return;
          if (!g) {
            Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
            router.back();
            return;
          }
          roster = r;
          setName(g.name);
          setSavedName(g.name);
          setIsOwner(g.isOwner);
          setPhotoUrl(g.photoUri ?? null);
          setMembers(roster);
          // The owner is always a member; the picker only covers the others.
          setSelected(new Set(roster.filter(m => m.id !== uid).map(m => m.id)));
        }

        // Everyone already in the group is listed too, connected or not.
        // Removing a connection (from either side) or blocking someone leaves
        // their membership in place, and a picker built from connections alone
        // hid them: MEMBERS (2) over one row, and no way to take the other out.
        // They can be unticked like anyone else, but not added back until you
        // connect again, which is what their tag says.
        const unconnected = roster.filter(m => m.id !== uid && !m.isOwner && !byId.has(m.id));
        setNotConnected(new Set(unconnected.map(m => m.id)));
        // Alphabetical: the buckets arrive in their own orders, and a list that
        // changes order depending on which one someone came from reads as
        // random to the person scrolling it.
        setCandidates([
          ...byId.values(),
          ...unconnected.map(m => ({ id: m.id, name: m.name, initials: m.initials, photoUri: m.photoUri })),
        ].sort((a, b) => a.name.localeCompare(b.name)));
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
    // Room for one more? The owner counts, and so does everyone ticked here,
    // invited or joined (0042). Unticking is always allowed, so a group already
    // over the limit can be brought back under it.
    if (!selected.has(clientId) && selected.size + 1 >= MAX_GROUP_MEMBERS) {
      Alert.alert(GROUP_FULL_TITLE, GROUP_FULL_MESSAGE);
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }, [selected]);

  // Pick from the library, frame it, and STAGE it. The upload happens in onSave,
  // which on a NEW group is the only time it can: there's no group id to file
  // the photo under until create_group has returned one.
  const pickPhoto = useCallback(async (afterAlert = false) => {
    if (busy) return;
    try {
      const photo = await pickSquarePhoto(AVATAR_PHOTO, { afterAlert });
      if (!photo) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhotoChange({ type: "set", uri: photo.uri, mimeType: photo.mimeType });
    } catch (e) {
      Alert.alert("Couldn't add photo", alertMessage(e, "Please try again."));
    }
  }, [busy]);

  const onPhotoPress = useCallback(() => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (shownPhoto) {
      Alert.alert("Group photo", undefined, [
        { text: "Change Photo", onPress: () => void pickPhoto(true) },
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

  // ── A member's view: the list, its search, each person's sheet ──

  const searchInputRef = useRef<TextInputInstance>(null);
  // Closing clears the query AND drops the keyboard together, so the X never
  // leaves one of the two behind, and reopening shows no stale filter. The
  // keyboard's down button does the same while you're typing a search.
  const closeSearch = useCallback(() => {
    setQuery("");
    Keyboard.dismiss();
    setSearchOpen(false);
  }, []);
  // The light haptic is the button's (GlassButton).
  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  }, [searchOpen, closeSearch]);
  // Asked before anything is dismissed: once the keyboard drops, nothing is
  // focused any more. The owner's name field just loses the keyboard.
  const onKeyboardDown = useCallback(() => {
    if (searchInputRef.current?.isFocused()) closeSearch();
    else Keyboard.dismiss();
  }, [closeSearch]);

  // The group page's order: starred people first, oldest star at the top, then
  // the roster's own (owner, trainers, then by name), sorted after the search
  // has filtered it.
  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
    return sortByFavourite(matched, favourites);
  }, [members, query, favourites]);

  // The keyboard goes first: a search left it up, and the sheet would open
  // above it.
  const openMember = useCallback((m: GroupMember) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    setMemberMenu(m);
  }, []);

  /** Star or unstar someone. Stars are account-wide, and the group page re-reads
   *  them as it comes back into view, so it shows this on the way back. The
   *  sheet's pill plays the tap. */
  const toggleMemberFavourite = useCallback(async (m: GroupMember) => {
    setFavourites(await toggleFavouriteMember(m.id));
  }, []);

  const openClientPage = useCallback((m: GroupMember) => {
    router.navigate({ pathname: "/trainer/client/[id]", params: { id: m.id } });
  }, [router]);

  /** Owner or trainer here: the group page's test for "Open client page". The
   *  role decides, not the account type. */
  const iCoachGroup = canCoachGroup(members.find(m => m.id === myUid)?.role ?? "member");

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy && !deleting;

  const ctaLabel = useMemo(() => {
    if (busy) return "Saving…";
    if (isNew) return selected.size > 0 ? `Create with ${selected.size} member${selected.size === 1 ? "" : "s"}` : "Create group";
    return "Save changes";
  }, [busy, isNew, selected.size]);

  // Unticking someone takes them out of the group on Save, so Save asks first.
  // Only people who were in the roster count: ticking and unticking someone
  // new changes nothing. The owner isn't in the picker, so can't be here.
  const onSave = () => {
    if (!canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const removed = isNew ? [] : members.filter(m => m.id !== myUid && !m.isOwner && !selected.has(m.id));
    if (removed.length === 0) {
      void save();
      return;
    }
    const names = removed.map(m => m.name);
    const listed = names.length <= 3
      ? names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : `${names.slice(0, 3).join(", ")} and ${names.length - 3} other${names.length - 3 === 1 ? "" : "s"}`;
    // Someone you're no longer connected with drops out of this list once
    // removed, so "add them back later" would be a promise it can't keep.
    const anyUnconnected = removed.some(m => notConnected.has(m.id));
    const addBack = !anyUnconnected
      ? "You can add them back later."
      : removed.length === 1
        ? "You're no longer connected, so you'd need to connect again to add them back."
        : "Anyone you're no longer connected with can only be added back once you connect again.";
    Alert.alert(
      removed.length === 1 ? `Remove ${names[0]}?` : `Remove ${removed.length} people?`,
      `${listed} will be removed from ${trimmed}${removed.some(m => m.accepted) ? " and stop receiving its messages" : ""}. ${addBack}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void save() },
      ],
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        const newId = await createGroup(trimmed, Array.from(selected));
        // The group exists either way from here: a photo that fails to upload is
        // reported on its own rather than taking the create down with it.
        try {
          await commitPhoto(newId);
        } catch (e) {
          Alert.alert("Group created", `The photo didn't upload. ${alertMessage(e, "Try again from the group's settings.")}`);
        }
        router.replace({ pathname: "/trainer/group/[id]", params: { id: newId, name: trimmed } });
        return;
      }
      await renameGroup(groupId, trimmed);
      await setGroupMembers(groupId, Array.from(selected));
      // The name and members are saved by now, so a photo that fails is said
      // on its own, not as "couldn't save group".
      try {
        await commitPhoto(groupId);
      } catch (e) {
        Alert.alert("Photo didn't upload", `Your other changes are saved. ${alertMessage(e, "Try adding the photo again.")}`);
        return;
      }
      router.back();
    } catch (e) {
      // The hub checks the creating limit before opening this screen, and the
      // picker the group's size; these are the database refusing what was out
      // of date (0042): groups made on another phone, or people added there.
      if (isGroupLimitError(e)) Alert.alert(GROUP_LIMIT_TITLE, groupLimitMessage("create", true));
      else if (isGroupFullError(e)) Alert.alert(GROUP_FULL_TITLE, GROUP_FULL_MESSAGE);
      else Alert.alert("Couldn't save group", alertMessage(e, "Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  // Delete group, at the foot of the owner's page (it was in the group page's
  // ⋯ menu; user request, 2026-10-29). Afterwards, straight to the Trainer tab,
  // where groups are listed: back to the group's page (or its chat, under it)
  // would only find the group gone and say so.
  const onDelete = () => {
    Alert.alert(
      `Delete ${savedName || "this group"}?`,
      "The group and its messages are removed for everyone. Programs you've already sent stay in your clients' libraries.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          setDeleting(true);
          try {
            await deleteGroup(groupId);
            dropGroupPage(groupId);
            router.dismissTo("/(tabs)/trainer-hub");
          } catch (e) {
            setDeleting(false);
            Alert.alert("Couldn't delete group", alertMessage(e, "Check your connection and try again."));
          }
        } },
      ],
    );
  };

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + BACK_TOP, borderBottomColor: t.div }]}>
        <BackButton inline />
        <Text style={[styles.headerTitle, { color: t.tp }]} numberOfLines={1}>
          {isNew ? "New Group" : isOwner ? "Manage Group" : "Group Members"}
        </Text>
        {/* A member's list is searched from here, opposite Back, as the
            Journal's Programs page is; live once it has loaded. Otherwise the
            space keeps the title centred. */}
        {!isNew && !isOwner ? (
          <GlassButton
            onPress={toggleSearch}
            size={BACK_SIZE}
            disabled={loading}
            accessibilityLabel={searchOpen ? "Close search" : "Search members"}
          >
            <Ionicons name={searchOpen ? "close" : "search"} size={searchOpen ? 22 : 19} color={t.tp} />
          </GlassButton>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={ACCT} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach) }}
        >
          {isOwner ? (
            <>
              {/* The photo sits above the name for the same reason it does on
                  the profile screen: it's the thing you recognise the group by
                  in a list, so it's the first thing you set. */}
              {/* The circle and the line under it are one button: the line
                  says "Tap to add", so it has to be something you can tap. */}
              <TouchableOpacity
                style={styles.photoBlock}
                onPress={onPhotoPress}
                activeOpacity={0.85}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={shownPhoto ? "Change group photo" : "Add group photo"}
              >
                <View>
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
                </View>
                <Text style={[styles.photoNote, { color: t.ts }]}>
                  {photoChange
                    ? `Tap ${isNew ? "Create" : "Save changes"} to apply the photo`
                    : shownPhoto ? "Tap to change the group photo" : "Tap to add a group photo"}
                </Text>
              </TouchableOpacity>

              <Text style={[styles.label, { color: t.ts }]}>GROUP NAME</Text>
              <NeuCard dark={isDark} radius={14}>
                <TextInput
                  style={[styles.input, { color: t.tp }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter a group name"
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
                            colorKey={c.id}
                            textStyle={styles.avatarText}
                          />
                          <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                          {c.isTrainer && (
                            <View style={[styles.ownerTag, { backgroundColor: `${ACCT}22` }]}>
                              <Text style={[styles.ownerTagText, { color: ACCT }]}>TRAINER</Text>
                            </View>
                          )}
                          {notConnected.has(c.id) && (
                            <View style={[styles.ownerTag, { backgroundColor: t.div }]}>
                              <Text style={[styles.ownerTagText, { color: t.ts }]}>NOT CONNECTED</Text>
                            </View>
                          )}
                          <View style={[styles.check, checked
                            ? { backgroundColor: ACCT, borderColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: glowOpacity(0.5, isDark), shadowRadius: 6 }
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
                <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT, opacity: canSave ? 1 : 0.4 }, darkGlow(styles.cta, isDark)]}>
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                </View>
              </BounceButton>

              {/* The red pill the ⋯ menu had, Save's size, set apart from it.
                  It needs the server, so it dims offline. */}
              {!isNew && (
                <BounceButton
                  style={{ marginTop: 24 }}
                  onPress={busy || deleting ? undefined : onDelete}
                  needsConnection
                  accessibilityLabel="Delete group"
                >
                  <View style={[
                    styles.deleteCta,
                    haloGlow(DANGER_BRIGHT, 0.5, 6, isDark),
                    { opacity: busy || deleting ? 0.4 : 1 },
                  ]}>
                    <Ionicons name="trash-outline" size={18} color={ON_FILL} />
                    <Text style={[styles.ctaText, { color: ON_FILL }]}>{deleting ? "Deleting…" : "Delete group"}</Text>
                  </View>
                </BounceButton>
              )}
            </>
          ) : (
            <>
              <Text style={[styles.readonlyName, { color: t.tp }]}>{name}</Text>
              <Text style={[styles.readonlyHint, { color: t.ts }]}>
                Only the trainer who created this group can change its name or members.
              </Text>
              {searchOpen && (
                <SearchField
                  inputRef={searchInputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search members"
                  autoFocus
                  style={styles.searchBox}
                />
              )}
              {visibleMembers.length === 0 && query.trim() ? (
                <Text style={[styles.noMatch, { color: t.ts }]}>No members match “{query.trim()}”.</Text>
              ) : null}
              {visibleMembers.map(m => {
                // Everyone but me opens their sheet, the group page's: starring,
                // and Report (group members see each other's names and photos
                // without being connected, Apple Guideline 1.2).
                const isMe = m.id === myUid;
                return (
                  <TouchableOpacity
                    key={m.id}
                    activeOpacity={0.85}
                    style={{ marginBottom: 10 }}
                    onPress={isMe ? undefined : () => openMember(m)}
                    disabled={isMe}
                    accessibilityRole={isMe ? "text" : "button"}
                    accessibilityLabel={m.isOwner ? `${m.name}, trainer` : m.name}
                  >
                    <NeuCard dark={isDark} radius={14}>
                      <View style={styles.row}>
                        <Avatar
                          uri={m.photoUri}
                          initials={m.initials}
                          size={40}
                          colorKey={m.id}
                          textStyle={styles.avatarText}
                        />
                        <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{m.name}</Text>
                        {m.isOwner && (
                          <View style={[styles.ownerTag, { backgroundColor: `${ACCT}22` }]}>
                            <Text style={[styles.ownerTagText, { color: ACCT }]}>TRAINER</Text>
                          </View>
                        )}
                        {/* Display only, once starred: starring is in their sheet. */}
                        {!isMe && favourites.has(m.id) ? <FavouriteStar size={15} /> : null}
                        {!isMe ? <Ionicons name="chevron-forward" size={16} color={t.ts} /> : null}
                      </View>
                    </NeuCard>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      {/* The group page's member sheet: the same actions, Report as a step of
          it. Only a member's view opens it, so it never offers the owner's. */}
      <GroupMemberSheet
        member={memberMenu}
        onClose={() => setMemberMenu(null)}
        starred={!!memberMenu && favourites.has(memberMenu.id)}
        onToggleFavourite={m => void toggleMemberFavourite(m)}
        onOpenClientPage={
          iCoachGroup && accountType === "pt" && !!memberMenu && clientIds.has(memberMenu.id)
            ? openClientPage
            : undefined
        }
      />

      <KeyboardDismissButton onPress={onKeyboardDown} />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: BACK_LEFT, paddingBottom: 12, borderBottomWidth: 1 },
  headerTitle:  { flex: 1, fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center" },
  loading:      { flex: 1, alignItems: "center", justifyContent: "center" },

  label:        { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },
  input:        { fontFamily: FontFamily.regular, fontSize: 16, paddingVertical: 14, paddingHorizontal: 16 },

  // Same geometry as the profile screen's photo picker, so setting a group's
  // photo and setting your own look and behave identically.
  // The tap target: centred, as wide as its caption, padded a little past it.
  photoBlock:   { alignSelf: "center", alignItems: "center", gap: 10, marginTop: -4, marginBottom: 20, paddingHorizontal: 16, paddingVertical: 4 },
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
  // Save's pill, in the sheet's danger red with its centred halo (laid on
  // inline, for dark mode's softer glow).
  deleteCta:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: PILL_RADIUS, paddingVertical: 15, backgroundColor: DANGER_BRIGHT },

  readonlyName: { fontFamily: FontFamily.bold, fontSize: 22, marginBottom: 6 },
  readonlyHint: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, marginBottom: 18 },
  searchBox:    { marginBottom: 12 },
  // The group page's "No members match".
  noMatch:      { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
});
