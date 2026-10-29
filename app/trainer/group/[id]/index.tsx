// A group's own page: who's in it, and the things you do with them (user
// decisions, 2026-10-22, the Group Page canvas, option B, for a trainer and a
// gym user alike).
//
// Top to bottom: back and ⋯ floating over the page; the group's photo, name
// and member count as the page's title (the owner taps them to manage the
// group); two tiles, Group Chat in orchid (its unread count as "3 new
// messages") and Programs (orange while reviews wait on a coach, periwinkle
// with something to accept); the green send button, "Send a Program" for the
// group's trainers and "Send a Program for Review" for everyone else; then
// Members, one line each in one card, with search and (the owner's) add. A
// member's row opens their sheet (components/trainer/GroupMemberSheet.tsx,
// which the member list in group-edit.tsx shares), Report included.
//
// The ⋯ menu's "Manage group" (the owner's) opens group-edit.tsx, where the
// name, photo and members are changed and the group is deleted (user request,
// 2026-10-29: it said "Manage members", and Delete sat in this menu).
//
// The group's programs are their own page now (./programs.tsx), where its
// archive is too. They were sections down this page, under the banner and
// above every member, each with a collapse, a green count and big cards.
//
// The CHAT lives one level down at ./chat: a group is a roster first and a
// conversation second.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Keyboard, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
  type ScrollViewInstance, type TextInputInstance, type ViewInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../../../../components/MaskedView";

import FadeScreen from "../../../../components/FadeScreen";
import NeuCard from "../../../../components/NeuCard";
import BounceButton from "../../../../components/BounceButton";
import GlassButton from "../../../../components/GlassButton";
import OfflineBanner from "../../../../components/OfflineBanner";
import Avatar from "../../../../components/Avatar";
import GroupAvatar from "../../../../components/trainer/GroupAvatar";
import SimpleSheet from "../../../../components/trainer/SimpleSheet";
import GroupMemberSheet from "../../../../components/trainer/GroupMemberSheet";
import HubTile from "../../../../components/trainer/HubTile";
import GroupSendSheet, { type GroupSendMode } from "../../../../components/trainer/GroupSendSheet";
import KeyboardDismissButton from "../../../../components/KeyboardDismissButton";
import GroupChatIcon from "../../../../components/icons/GroupChatIcon";
import NotebookIcon from "../../../../components/icons/NotebookIcon";
import UserPlusIcon from "../../../../components/icons/UserPlusIcon";
import SendIcon from "../../../../components/icons/SendIcon";
import PeopleIcon from "../../../../components/icons/PeopleIcon";
import FavouriteStar, { useFavouriteGold } from "../../../../components/FavouriteStar";
import SheetPill from "../../../../components/SheetPill";
import SearchField from "../../../../components/SearchField";
import BackButton, { BACK_LEFT, BACK_SIZE, BACK_TOP } from "../../../../components/BackButton";
import {
  ACCT,
  APP_DARK,
  APP_LIGHT,
  AWAITING_ORANGE,
  FontFamily,
  ROLE_MEMBER,
  ROLE_OWNER,
  ROLE_TRAINER,
  chatOrchid,
  chatOrchidText,
  compareBlue,
  compareBlueText,
  dangerTextColor,
  replacedTextColor,
  roleTextColor,
} from "../../../../constants/theme";
import { darkGlow, pill, pillGlow, PILL_H_SM, PILL_SHADOW } from "../../../../constants/buttons";
import { CARD_META, CARD_TITLE, SUMMARY_ROW } from "../../../../constants/cards";
import { scrollEndPadding } from "../../../../constants/floatingBars";
import { useFloatingBarsReach } from "../../../../hooks/useFloatingBars";
import { useTheme } from "../../../../contexts/ThemeContext";
import { useAccountType } from "../../../../contexts/AccountTypeContext";
import { useAuth } from "../../../../contexts/AuthContext";
import { fetchGroupMemberStatus, fetchGroupMembers, leaveGroup, setGroupMemberRole, setGroupMembers, subscribeToGroup } from "../../../../lib/groups";
import { isActiveNow, presenceLabel, PRESENCE_REFRESH_MS } from "../../../../utils/presence";
import { getMyUid } from "../../../../lib/chat";
import { loadFavouriteMemberIds, loadGroupUnread, sortByFavourite, toggleFavouriteGroup, toggleFavouriteMember } from "../../../../utils/groupStore";
import { loadGroupReviewPrograms, loadGroupSharedPrograms } from "../../../../utils/trainerStore";
import {
  dropGroupPage,
  EMPTY_GROUP_PAGE,
  hydrateGroupPage,
  loadGroupPage,
  peekGroupPage,
  saveGroupPage,
  type GroupPageData,
  type GroupPageLoad,
} from "../../../../utils/groupPage";
import { groupProgramLists, groupProgramsTile } from "../../../../utils/groupPrograms";
import { getJSON } from "../../../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../../../constants/programs";
import { canCoachGroup, type GroupMember, type GroupRole } from "../../../../constants/groups";
import { alertMessage } from "../../../../utils/errors";

/** Space kept between the bottom of the member search field and the keyboard.
 *  Not just enough to clear it: the matches appear UNDER the field, and the
 *  keyboard's down button closes the search, so this leaves room for a few of
 *  them (and clears that floating button, which sits ~55pt above the keyboard). */
const SEARCH_KEYBOARD_GAP = 130;

/** The round buttons on the Members heading (search, add members). */
const SECTION_BTN = 36;

const ROLE_LABEL: Record<GroupRole, string> = {
  owner:   "OWNER",
  trainer: "TRAINER",
  member:  "MEMBER",
};

const ROLE_COLOR: Record<GroupRole, string> = {
  owner:   ROLE_OWNER,
  trainer: ROLE_TRAINER,
  member:  ROLE_MEMBER,
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function GroupPageScreen() {
  const router = useRouter();
  const { accountType } = useAccountType();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The options-menu label sits beside the star and must match it exactly.
  const favouriteGold = useFavouriteGold();
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();

  const groupId = id ?? "";
  // The account this page's saved copy belongs to (utils/pageSnapshot.ts).
  const { userId } = useAuth();
  const owner = userId ?? "";

  /**
   * Everything on this page, as ONE value (utils/groupPage.ts).
   *
   * It starts on the copy saved from the last visit, so the page opens whole
   * rather than on a spinner, and a load replaces it in a single render, so
   * arriving or pulling down updates it in place. The group's Programs page
   * reads and saves the same copy.
   *
   * Null only when this group has never loaded on this device.
   */
  const [page, setPage] = useState<GroupPageData | null>(() => peekGroupPage(owner, groupId));
  /** A load has answered, even with a failure: the spinner stops either way. */
  const [settled, setSettled] = useState(false);
  const loading = page === null && !settled;
  const {
    group,
    members,
    clients,
    activeProgramByClient,
    unread,
    isFavourite,
    favouriteMemberIds,
    groupShares,
    groupReviews,
    blockedMemberIds,
    memberStatus,
    myUid,
  } = page ?? EMPTY_GROUP_PAGE;
  const blockedMembers = useMemo(() => new Set(blockedMemberIds ?? []), [blockedMemberIds]);
  /** Starred PEOPLE, oldest star first — the order they're pinned in. */
  const favouriteMembers = useMemo(() => new Set(favouriteMemberIds), [favouriteMemberIds]);

  // Whatever the page shows is what it opens on next time, including a change
  // made here (a role, a star) that no load has seen yet.
  useEffect(() => {
    if (page) saveGroupPage(owner, groupId, page);
  }, [page, owner, groupId]);

  // The hub reads its groups' copies off the device ahead of time; opened any
  // other way (a notification, a link), read it now. A load that has already
  // landed is newer, so the copy never replaces it.
  useEffect(() => {
    let live = true;
    void hydrateGroupPage(owner, groupId).then(() => {
      const saved = peekGroupPage(owner, groupId);
      if (live && saved) setPage(p => p ?? saved);
    });
    return () => { live = false; };
  }, [owner, groupId]);

  const [menuOpen, setMenuOpen] = useState(false);
  /** The member whose sheet is open (null = closed). */
  const [memberMenu, setMemberMenu] = useState<GroupMember | null>(null);
  const [picker, setPicker] = useState<GroupSendMode | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Local, and only the program picker and my own row read it, so it's not
  // part of the page's saved copy.
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);

  const displayName = group?.name || name || "Group";

  /** My own standing in this group. Owner or trainer here: the same test the
   *  database enforces for sending to it (can_coach_in_group). The ROLE
   *  decides, not the account type: a gym user the owner makes a trainer sends
   *  exactly like a trainer account does. */
  const myRole: GroupRole = members.find(m => m.id === myUid)?.role ?? "member";
  const iCoachGroup = canCoachGroup(myRole);

  // The Programs tile's line, read off the sections its page lists
  // (utils/groupPrograms.ts), so the two never disagree.
  const programsTile = useMemo(
    () => groupProgramsTile(groupProgramLists({ groupShares, groupReviews, iCoachGroup, myUid }), iCoachGroup),
    [groupShares, groupReviews, iCoachGroup, myUid],
  );

  /** Put a load's answer on the page. A failed load keeps what's showing (the
   *  saved copy, or the empty page when there's none), and every answer stops
   *  the spinner. */
  const applyLoad = useCallback((result: GroupPageLoad) => {
    setSettled(true);
    if (result.status === "loaded") {
      setPage(result.data);
    } else if (result.status === "gone") {
      Alert.alert("Group unavailable", "This group no longer exists, or you're no longer a member.");
      router.back();
    }
  }, [router]);

  const loadMyPrograms = useCallback(
    () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []).then(progs => (Array.isArray(progs) ? progs : [])),
    [],
  );

  /**
   * Arriving brings the page up to date. First the saved copy, which the
   * group's Programs page writes too, so an accept or a remove made there shows
   * on the way back at once; then the load, in one render when it lands. The
   * cancel flag stops a load that outlives the visit from writing to the page;
   * a loaded result is saved regardless (loadGroupPage).
   *
   * Stars are this phone's alone and change on other pages while this one
   * waits underneath (the member list, a client's page), so they're read
   * straight off the device too, rather than waiting on the load (which never
   * lands offline). Only a change touches the page.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const saved = peekGroupPage(owner, groupId);
    if (saved) setPage(saved);
    void loadFavouriteMemberIds().then(ids => {
      if (cancelled) return;
      const next = [...ids];
      setPage(p => (p && next.join() !== p.favouriteMemberIds.join() ? { ...p, favouriteMemberIds: next } : p));
    });
    void loadGroupPage(owner, groupId).then(result => { if (!cancelled) applyLoad(result); });
    void loadMyPrograms().then(progs => { if (!cancelled) setMyPrograms(progs); });
    return () => { cancelled = true; };
  }, [owner, groupId, applyLoad, loadMyPrograms]));

  /**
   * The Group Chat tile's count, kept live while this page is on screen: each
   * new message from someone else re-reads it through loadGroupUnread, the
   * page load's own read, so a blocked member's or a hidden message still
   * doesn't count, and my own sends never do. Focus-scoped: the chat marks the
   * thread read and has its own listener. Its own channel key.
   */
  useFocusEffect(useCallback(() => {
    if (!groupId) return;
    let active = true;
    const unsubscribe = subscribeToGroup(groupId, async senderId => {
      const uid = await getMyUid();
      if (!active || senderId === uid) return;
      const count = await loadGroupUnread(groupId);
      if (active) setPage(p => p && { ...p, unread: count });
    }, "page");
    return () => { active = false; unsubscribe(); };
  }, [groupId]));

  /**
   * The members' "Active now" kept current while this page is on screen, as
   * the Trainer tab keeps its clients' (hooks/useConnectionPresence.ts): a
   * fresh read every PRESENCE_REFRESH_MS and on returning to the app. Each
   * answer re-renders the rows, so a stale "Active now" ages into "Last active
   * 4m ago" even when nothing changed. A failed read keeps what's showing.
   */
  useFocusEffect(useCallback(() => {
    if (!groupId) return;
    let active = true;
    const refresh = async () => {
      const next = await fetchGroupMemberStatus(groupId);
      if (active && Object.keys(next).length > 0) setPage(p => p && { ...p, memberStatus: next });
    };
    const timer = setInterval(refresh, PRESENCE_REFRESH_MS);
    const sub = AppState.addEventListener("change", s => { if (s === "active") void refresh(); });
    return () => { active = false; clearInterval(timer); sub.remove(); };
  }, [groupId]));

  /** Pull down to re-read the group: new messages, a program a coach just
   *  sent, a review someone posted, someone who accepted their invite. Always
   *  clears the spinner: `loadGroupPage` never rejects. */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const [result, progs] = await Promise.all([loadGroupPage(owner, groupId), loadMyPrograms()]);
    applyLoad(result);
    setMyPrograms(progs);
    setRefreshing(false);
  }, [owner, groupId, applyLoad, loadMyPrograms]);

  /** After a send from here: re-read the group's programs so the Programs
   *  tile counts it on this tick. */
  const refreshPrograms = useCallback(async () => {
    try {
      const [shares, reviews] = await Promise.all([loadGroupSharedPrograms(groupId), loadGroupReviewPrograms(groupId)]);
      setPage(p => p && { ...p, groupShares: shares, groupReviews: reviews });
    } catch (err) {
      if (__DEV__) console.warn("[avenas] refresh group programs", err);
    }
  }, [groupId]);

  const openChat = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/group/[id]/chat", params: { id: groupId, name: displayName } });
  }, [router, groupId, displayName]);

  const openPrograms = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/trainer/group/[id]/programs", params: { id: groupId, name: displayName } });
  }, [router, groupId, displayName]);

  const openManage = useCallback(() => {
    setMenuOpen(false);
    router.navigate({ pathname: "/trainer/group-edit", params: { id: groupId } });
  }, [router, groupId]);

  const onToggleFavourite = useCallback(async () => {
    setMenuOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavouriteGroup(groupId);
    setPage(p => p && { ...p, isFavourite: next.has(groupId) });
  }, [groupId]);

  /** Star or unstar a person. The list re-sorts on the next render, so the row
   *  travels to the top (or back into the roster) as you tap it. Starring is
   *  account-wide rather than per-group. */
  const onToggleMemberFavourite = useCallback(async (memberId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavouriteMember(memberId);
    setPage(p => p && { ...p, favouriteMemberIds: [...next] });
  }, []);

  const searchInputRef = useRef<TextInputInstance>(null);
  // Closing clears the query AND drops the keyboard in the same step, so the
  // search row and the keyboard go together rather than leaving one behind,
  // and reopening never shows a stale filter. The X does this, and so does the
  // keyboard's down button while you're typing a search.
  const closeSearch = useCallback(() => {
    setQuery("");
    Keyboard.dismiss();
    setSearchOpen(false);
  }, []);
  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  }, [searchOpen, closeSearch]);
  // Asked before anything is dismissed: once the keyboard drops, nothing is
  // focused any more.
  const onKeyboardDown = useCallback(() => {
    if (searchInputRef.current?.isFocused()) closeSearch();
    else Keyboard.dismiss();
  }, [closeSearch]);

  // Members is the page's last section, so its search field opened underneath
  // the keyboard. While searching with the keyboard up, the page grows by the
  // keyboard's height (the ScrollView's paddingBottom) and scrolls just far
  // enough to lift the field SEARCH_KEYBOARD_GAP above it. When the keyboard
  // drops, the page goes back to where it was.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  const searchBoxRef = useRef<ViewInstance>(null);
  const [kbHeight, setKbHeight] = useState(0);
  const kbTop = useRef(0);
  const preSearchY = useRef<number | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => {
      kbTop.current = e.endCoordinates.screenY;
      setKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (searchOpen && kbHeight > 0) {
      // A frame after the taller page has laid out, so the scroll can reach it.
      const frame = requestAnimationFrame(() => {
        searchBoxRef.current?.measureInWindow((_x, y, _w, h) => {
          const overlap = y + h - (kbTop.current - SEARCH_KEYBOARD_GAP);
          if (overlap <= 0) return;
          if (preSearchY.current === null) preSearchY.current = scrollY.current;
          scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (kbHeight === 0 && preSearchY.current !== null) {
      scrollRef.current?.scrollTo({ y: preSearchY.current, animated: true });
      preSearchY.current = null;
    }
  }, [searchOpen, kbHeight]);

  // The keyboard goes first: a search left it up, and the sheet (its report
  // reasons most of all) would open above it, half off the top of the screen.
  const openMemberMenu = useCallback((m: GroupMember) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    setMemberMenu(m);
  }, []);

  /** Their client page, from their sheet: only ever offered for my client. */
  const openClientPage = useCallback((m: GroupMember) => {
    router.navigate({ pathname: "/trainer/client/[id]", params: { id: m.id } });
  }, [router]);

  // Promote to trainer, or demote back. Owner-only, and the RPC enforces that
  // server-side too rather than trusting this screen. The member's sheet has
  // closed by now, as it does before every action.
  const toggleRole = useCallback(async (m: GroupMember) => {
    const next = m.role === "trainer" ? "member" : "trainer";
    try {
      await setGroupMemberRole(groupId, m.id, next);
      setPage(p => p && { ...p, members: p.members.map(x => (x.id === m.id ? { ...x, role: next } : x)) });
      Alert.alert(
        next === "trainer" ? "Now a trainer" : "Now a member",
        next === "trainer"
          ? `${m.name} can send programs to this group and to people in it.`
          : `${m.name} can no longer send programs to this group.`,
      );
    } catch (e) {
      Alert.alert("Couldn't change role", alertMessage(e, "Check your connection and try again."));
    }
  }, [groupId]);

  // Take someone out of the group, or withdraw their invite. Owner-only, and
  // set_group_members refuses anyone else. That RPC replaces the roster
  // wholesale, so it's handed the roster read NOW minus this one person: the
  // page's copy could still list someone who has since left, and passing them
  // would invite them straight back.
  const removeMember = useCallback((m: GroupMember) => {
    Alert.alert(
      m.accepted ? `Remove ${m.name}?` : `Cancel ${m.name}'s invite?`,
      m.accepted
        ? `They'll leave ${displayName} and stop receiving its messages. You can add them back later.`
        : `They won't be able to join ${displayName}. You can invite them again later.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: m.accepted ? "Remove" : "Cancel Invite", style: "destructive", onPress: async () => {
          try {
            const roster = await fetchGroupMembers(groupId);
            const rest = roster.filter(x => x.id !== m.id);
            await setGroupMembers(groupId, rest.filter(x => !x.isOwner).map(x => x.id));
            setPage(p => p && { ...p, members: rest });
          } catch (e) {
            Alert.alert(m.accepted ? "Couldn't remove them" : "Couldn't cancel the invite", alertMessage(e, "Check your connection and try again."));
          }
        } },
      ],
    );
  }, [groupId, displayName]);

  // Everyone in the group except me. A trainer never sends a program to
  // themselves, and only real connections can receive one.
  const recipientIds = useMemo(() => members.filter(m => m.id !== myUid).map(m => m.id), [members, myUid]);

  // Filters the list only: the count and a program send stay whole-group.
  // Starred people first, oldest star at the top, then the roster's own order
  // (owner, trainers, then by name), sorted AFTER the search filter so a
  // search's matches are pinned the same way the full list is.
  const visibleMembers = (() => {
    const q = query.trim().toLowerCase();
    const matched = q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
    return sortByFavourite(matched, favouriteMembers);
  })();

  /** My own row reads its program from MY programs, not from the per-client
   *  store the other rows use: I'm not one of my own clients. */
  const myActiveProgramName = myPrograms.find(p => p.status === "active")?.name;

  /**
   * One row's worth of decisions.
   *
   * The badge: an outstanding invite outranks the role (what they'd be once
   * they join is less useful than knowing they haven't); my own row says "YOU"
   * AND my role ("YOU · TRAINER"), so someone made a trainer can see it;
   * someone I've blocked reads "BLOCKED", in grey, over everything else (they
   * stay in a group I don't own, their messages and programs hidden from me).
   *
   * The line under the name, for trainers and gym users alike (user request,
   * 2026-10-22): the program they're running and when they were last on the
   * app, with the Trainer tab's dot, green when active now (0051,
   * `memberStatus`). Either is absent when they've turned Activity Status off
   * (a connected trainer still sees their client's program), and so is the
   * line when both are: nothing says it's hidden. My own row shows my program;
   * someone I've blocked shows nothing. `activeProgramByClient` stands in for
   * a coach's clients until 0051 is on the database.
   *
   * The tap: everyone but me opens the same sheet, whatever my standing here;
   * what the sheet OFFERS is gated by role. My own row opens nothing: the
   * client page is about someone you coach, and I'm not on my own roster.
   */
  const memberRows = visibleMembers.map(m => {
    const isMe = m.id === myUid;
    const isBlocked = !isMe && blockedMembers.has(m.id);
    const roleShown = !isBlocked && (isMe || m.accepted);
    const status = isMe || isBlocked ? undefined : memberStatus?.[m.id];
    const program = isMe
      ? myActiveProgramName ?? "No active program"
      : isBlocked ? undefined : status?.program ?? activeProgramByClient[m.id];
    const lastActive = status?.lastActiveAt;
    return {
      member: m,
      isMe,
      badge: isBlocked ? "BLOCKED" : isMe ? `YOU · ${ROLE_LABEL[m.role]}` : m.accepted ? ROLE_LABEL[m.role] : "INVITED",
      badgeFill: roleShown ? `${ROLE_COLOR[m.role]}22` : t.div,
      badgeInk: roleShown ? roleTextColor(m.role, isDark) : t.ts,
      meta: [program, lastActive ? presenceLabel(lastActive) : null].filter(Boolean).join(" · "),
      lastActive,
      onPress: isMe ? undefined : () => openMemberMenu(m),
    };
  });

  const onLeave = () => {
    setMenuOpen(false);
    Alert.alert(
      `Leave ${displayName}?`,
      "You'll stop receiving messages from this group. The trainer can add you back later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: async () => {
          try {
            if (!myUid) throw new Error("not signed in");
            await leaveGroup(myUid, groupId);
            dropGroupPage(groupId);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't leave", alertMessage(e, "Check your connection and try again."));
          }
        } },
      ],
    );
  };

  // The Programs tile's colour: orange while reviews wait on a coach,
  // periwinkle otherwise (a gym user's Programs tile's), its words the same
  // colour's ink when there's something new, red when a request of mine was
  // removed without a review, and grey when there's nothing.
  const programsMark = programsTile.tone === "waiting" ? AWAITING_ORANGE : compareBlue(isDark);
  const programsInk = programsTile.tone === "waiting" ? replacedTextColor(isDark)
    : programsTile.tone === "new" ? compareBlueText(isDark)
    : programsTile.tone === "alert" ? dangerTextColor(isDark) : t.ts;
  const chatLine = unread > 0 ? plural(unread, "new message") : "Message everyone";

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.5)", "transparent"]}
            locations={[0, 0.6, 0.85, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <BackButton />
      {/* The group's options, facing the back button: same top, same inset,
          same circle, and like it no shadow. */}
      <GlassButton
        onPress={() => setMenuOpen(true)}
        size={BACK_SIZE}
        style={[styles.optionsFloat, { top: insets.top + BACK_TOP }]}
        accessibilityLabel="Group options"
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
      </GlassButton>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={ACCT} /></View>
      ) : (
        // A plain ScrollView, not react-native-keyboard-controller's
        // KeyboardAwareScrollView: that is a Reanimated.ScrollView, which on
        // Fabric doesn't reflow for content growing inside it. The keyboard
        // handling for the member search is the effect above.
        <ScrollView
          ref={scrollRef}
          onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          // Without this the keyboard eats the first tap on any button while
          // the search field is focused, so closing search took two taps.
          keyboardShouldPersistTaps="handled"
          // Searching with the keyboard up adds its height below the page, so
          // a search field at the very bottom has room to scroll above it.
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: insets.top + BACK_TOP + BACK_SIZE + 14,
            paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach) + (searchOpen ? kbHeight : 0),
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={ACCT}
              colors={[ACCT]}
              progressViewOffset={insets.top}
            />
          }
        >
          <OfflineBanner />

          {/* The group as the page's title: its photo, its name, how many are
              in it. The owner taps it to manage the group (photo, name,
              members); for anyone else it's a title, not a control. The faces
              that sat under the name went: the members are listed just below
              (user feedback, 2026-10-22). */}
          <TouchableOpacity
            style={styles.titleRow}
            activeOpacity={group?.isOwner ? 0.8 : 1}
            onPress={group?.isOwner ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openManage(); } : undefined}
            disabled={!group?.isOwner}
            accessibilityRole={group?.isOwner ? "button" : "header"}
            accessibilityLabel={group?.isOwner ? `Manage ${displayName}` : displayName}
          >
            <GroupAvatar uri={group?.photoUri} size={56} isDark={isDark} colorKey={groupId} />
            <View style={styles.titleText}>
              <View style={styles.nameRow}>
                <Text style={[styles.title, { color: t.tp }]} numberOfLines={2}>{displayName}</Text>
                {isFavourite ? <FavouriteStar size={18} /> : null}
              </View>
              <Text style={[styles.memberCount, { color: t.ts }]}>{plural(members.length, "member")}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.tiles}>
            <HubTile
              icon={<GroupChatIcon size={18} color={chatOrchid(isDark)} />}
              mark={chatOrchid(isDark)}
              title="Group Chat"
              meta={chatLine}
              metaColor={unread > 0 ? chatOrchidText(isDark) : t.ts}
              onPress={openChat}
              accessibilityLabel={`Group Chat, ${chatLine}`}
            />
            <HubTile
              icon={<NotebookIcon size={18} color={programsMark} />}
              mark={programsMark}
              title="Programs"
              meta={programsTile.line}
              metaColor={programsInk}
              onPress={openPrograms}
              accessibilityLabel={`Programs, ${programsTile.line}`}
            />
          </View>

          {/* Sending OUT to the group belongs to the owner and anyone they've
              made a trainer here; everyone else asks for a review. A trainer
              here who isn't the owner asks for one from the Programs page. */}
          <BounceButton
            style={styles.sendWrap}
            onPress={() => setPicker(iCoachGroup ? "send" : "review")}
            needsConnection
            accessibilityLabel={iCoachGroup ? "Send a program to this group" : "Send a program to this group for review"}
          >
            <View style={[styles.sendBtn, { backgroundColor: ACCT }, darkGlow(styles.sendBtn, isDark)]}>
              <SendIcon size={18} color="#fff" />
              <Text style={styles.sendText}>{iCoachGroup ? "Send a Program" : "Send a Program for Review"}</Text>
            </View>
          </BounceButton>

          <View style={styles.sectionRow}>
            <View style={styles.sectionTitle}>
              <Text style={[styles.sectionHeading, { color: t.tp }]}>Members</Text>
              {/* The total, not the filtered count: group size is a stable
                  fact, and the list below shows what a search matched. */}
              {members.length > 0 ? <Text style={[styles.sectionCount, { color: t.ts }]}>{members.length}</Text> : null}
            </View>
            {members.length > 0 && (
              <GlassButton
                onPress={toggleSearch}
                size={SECTION_BTN}
                solidStyle={PILL_SHADOW}
                accessibilityLabel={searchOpen ? "Close search" : "Search members"}
              >
                <Ionicons name={searchOpen ? "close" : "search"} size={18} color={t.tp} />
              </GlassButton>
            )}
            {group?.isOwner && (
              <GlassButton onPress={openManage} size={SECTION_BTN} solidStyle={PILL_SHADOW} accessibilityLabel="Add members">
                <UserPlusIcon size={18} color={t.tp} />
              </GlassButton>
            )}
          </View>

          {searchOpen && (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.searchRow}>
              <SearchField
                boxRef={searchBoxRef}
                inputRef={searchInputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search members"
                autoFocus
              />
            </Animated.View>
          )}

          {members.length === 0 ? (
            <NeuCard dark={isDark} radius={20}>
              <View style={styles.emptyInner}>
                <View style={[styles.emptyIcon, { backgroundColor: isDark ? `${ACCT}1A` : `${ACCT}24` }]}>
                  <PeopleIcon size={26} color={ACCT} />
                </View>
                <Text style={[styles.emptyTitle, { color: t.tp }]}>No members yet</Text>
                <Text style={[styles.emptyBody, { color: t.ts }]}>
                  Add clients to this group to message them together and send one program to all of them.
                </Text>
              </View>
            </NeuCard>
          ) : memberRows.length === 0 ? (
            <Text style={[styles.noMatch, { color: t.ts }]}>No members match “{query.trim()}”.</Text>
          ) : (
            // One line each, in one card: the Trainer tab's Clients.
            <NeuCard dark={isDark} radius={16}>
              {memberRows.map((r, i) => (
                <TouchableOpacity
                  key={r.member.id}
                  onPress={r.onPress}
                  disabled={!r.onPress}
                  activeOpacity={0.7}
                  accessibilityRole={r.onPress ? "button" : "text"}
                  accessibilityLabel={`${r.member.name}, ${r.badge.toLowerCase()}${r.meta ? `, ${r.meta}` : ""}`}
                  style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: t.div }]}
                >
                  <Avatar
                    uri={r.member.photoUri}
                    initials={r.member.initials}
                    size={36}
                    colorKey={r.member.id}
                    textStyle={styles.avatarText}
                  />
                  <View style={styles.rowText}>
                    <View style={styles.rowNameLine}>
                      <Text style={[styles.rowTitle, styles.rowName, { color: t.tp }]} numberOfLines={1}>{r.member.name}</Text>
                      <View style={[styles.tag, { backgroundColor: r.badgeFill }]}>
                        <Text style={[styles.tagText, { color: r.badgeInk }]}>{r.badge}</Text>
                      </View>
                    </View>
                    {r.meta ? (
                      <View style={styles.metaRow}>
                        {/* Green when they're active now, the grey of everyone
                            else, as on the Trainer tab's Clients. */}
                        {r.lastActive ? (
                          <View style={[styles.dot, { backgroundColor: isActiveNow(r.lastActive) ? ACCT : t.ts }]} />
                        ) : null}
                        <Text style={[styles.rowMeta, styles.metaText, { color: t.ts }]} numberOfLines={1}>{r.meta}</Text>
                      </View>
                    ) : null}
                  </View>
                  {/* Display only, and only once starred: starring is in the
                      person's sheet. Never on my own row. */}
                  {!r.isMe && favouriteMembers.has(r.member.id) ? <FavouriteStar size={15} /> : null}
                  {r.onPress ? <Ionicons name="chevron-forward" size={16} color={t.ts} /> : null}
                </TouchableOpacity>
              ))}
            </NeuCard>
          )}
        </ScrollView>
      )}

      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{displayName}</Text>
        <View style={styles.menu}>
          <SheetPill
            label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            tint={isFavourite ? favouriteGold : undefined}
            icon={() => <FavouriteStar size={20} filled={isFavourite} inactiveColor={t.tp} />}
            onPress={onToggleFavourite}
            accessibilityState={{ selected: isFavourite }}
          />
          {/* The owner's page edits the name, photo and who's in the group,
              and deletes it; anyone else's lists the members. */}
          <SheetPill
            label={group?.isOwner ? "Manage group" : "View members"}
            icon={c => <Ionicons name={group?.isOwner ? "create-outline" : "people-outline"} size={18} color={c} />}
            onPress={openManage}
          />
          {!group?.isOwner && (
            <SheetPill label="Leave group" variant="danger" icon={c => <Ionicons name="exit-outline" size={18} color={c} />} onPress={onLeave} />
          )}
        </View>
      </SimpleSheet>

      {/* Per-member sheet, open to anyone: favouriting and Report are there,
          so it can't be owner-only. The client page is a coaching surface, for
          my own clients; the role and removal are the owner's. */}
      <GroupMemberSheet
        member={memberMenu}
        onClose={() => setMemberMenu(null)}
        starred={!!memberMenu && favouriteMembers.has(memberMenu.id)}
        onToggleFavourite={m => void onToggleMemberFavourite(m.id)}
        onOpenClientPage={
          iCoachGroup && accountType === "pt" && !!memberMenu && clients.some(c => c.id === memberMenu.id)
            ? openClientPage
            : undefined
        }
        onToggleRole={group?.isOwner ? toggleRole : undefined}
        onRemove={group?.isOwner ? removeMember : undefined}
      />

      <GroupSendSheet
        mode={picker}
        onClose={() => setPicker(null)}
        groupId={groupId}
        groupName={displayName}
        ownerId={group?.ownerId}
        recipientIds={recipientIds}
        programs={myPrograms}
        onSent={refreshPrograms}
      />

      {/* The floating keyboard-down button for the member search. Last child
          so it sits above the scroll content; renders nothing without a
          keyboard. */}
      <KeyboardDismissButton onPress={onKeyboardDown} />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  // Mirrors the back button across the screen, as the floating archive button
  // does (components/ArchiveButton.tsx).
  optionsFloat: { position: "absolute", right: BACK_LEFT, zIndex: 10 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  titleRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  titleText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  // The Trainer tab's title size (HubTitle): this page is the group's hub.
  title: { flexShrink: 1, fontFamily: FontFamily.bold, fontSize: 28, lineHeight: 34 },
  memberCount: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 19, marginTop: 2 },

  tiles: { flexDirection: "row", gap: 12, marginTop: 20 },
  sendWrap: { marginTop: 16 },
  sendBtn: { ...pill(PILL_H_SM), gap: 10, ...pillGlow(ACCT, 0.4) },
  sendText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },

  // The Trainer tab's section row (PTHome), value for value: the count on the
  // heading's baseline, the round buttons centred in the row.
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, marginTop: 18, marginBottom: 4 },
  sectionTitle: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  sectionHeading: { fontFamily: FontFamily.bold, fontSize: 18 },
  sectionCount: { fontFamily: FontFamily.bold, fontSize: 15 },
  searchRow: { marginBottom: 12 },
  noMatch: { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },

  // A member, as a client is on the Trainer tab.
  row: { ...SUMMARY_ROW, paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { ...CARD_TITLE },
  // `flexShrink`, not `flex`, so a long name truncates and the badge stays.
  rowName: { flexShrink: 1 },
  rowMeta: { ...CARD_META },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  metaText: { flexShrink: 1, marginTop: 0 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 13 },

  emptyInner: { padding: 24, alignItems: "center", gap: 10 },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },

  menuName: { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu: { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
});
