// Temporary cloud sync test screen. Lets you sign in with email/password and
// push your local data up to Supabase to confirm the backend round-trip works
// from the device. Reached from Settings ("Cloud sync (test)"). This is a dev
// harness — the real auth lives in onboarding/signup once verified.

import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";

import FadeScreen from "../components/FadeScreen";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { cloudCounts, pullAllFromCloud, pushAllLocalDataToCloud, syncOnLogin, type SyncCounts } from "../lib/cloud";
import { oauthRedirectTo, signInWithProvider } from "../lib/auth";
import GoogleIcon from "../components/icons/GoogleIcon";

export default function CloudTestScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [counts, setCounts] = useState<SyncCounts | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await fn());
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const signUp = () => run("Signing up", async () => {
    const { error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    return "Signed up and logged in.";
  });
  const signIn = () => run("Signing in", async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return "Signed in.";
  });
  const signOut = () => run("Signing out", async () => {
    await supabase.auth.signOut();
    setCounts(null);
    return "Signed out.";
  });
  const push = () => run("Pushing local data to cloud", async () => {
    if (!session) throw new Error("Sign in first.");
    const r = await pushAllLocalDataToCloud(session.user.id);
    setCounts(await cloudCounts(session.user.id));
    return `Pushed ${r.programs} programs, ${r.workouts} workouts, ${r.journal} journal, ${r.customExercises} custom exercises.`;
  });
  const pull = () => {
    Alert.alert(
      "Pull from cloud?",
      "This replaces the data on this device with the copy in the cloud.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Pull",
          style: "destructive",
          onPress: () => run("Pulling cloud to device", async () => {
            if (!session) throw new Error("Sign in first.");
            const r = await pullAllFromCloud(session.user.id);
            setCounts(await cloudCounts(session.user.id));
            return `Pulled ${r.programs} programs, ${r.workouts} workouts, ${r.journal} journal, ${r.customExercises} custom to this device. Reopen the app to see them.`;
          }),
        },
      ],
    );
  };
  const smartSync = () => run("Smart sync", async () => {
    if (!session) throw new Error("Sign in first.");
    const { direction, counts: c } = await syncOnLogin(session.user.id);
    setCounts(await cloudCounts(session.user.id));
    if (direction === "pushed") return `Cloud was empty → pushed ${c.programs} programs, ${c.workouts} workouts up.`;
    if (direction === "pulled") return `Local was empty → pulled ${c.programs} programs, ${c.workouts} workouts down.`;
    return "Both sides have data → left as-is (use Push or Pull to choose).";
  });
  const oauth = (provider: "google" | "apple") =>
    run(`Signing in with ${provider}`, async () => {
      await signInWithProvider(provider);
      return `Signed in with ${provider}.`;
    });
  const refresh = () => run("Counting cloud rows", async () => {
    if (!session) throw new Error("Sign in first.");
    setCounts(await cloudCounts(session.user.id));
    return "Cloud counts refreshed.";
  });

  const inputStyle = [styles.input, {
    color: t.tp,
    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
    borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
  }];

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <BounceButton onPress={() => router.back()} accessibilityLabel="Go back">
            <View style={[styles.backBtn, { backgroundColor: isDark ? t.div : "#fff" }]}>
              <Ionicons name="chevron-back" size={22} color={t.tp} />
            </View>
          </BounceButton>
          <Text style={[styles.title, { color: t.tp }]}>Cloud sync test</Text>
          <View style={{ width: 40 }} />
        </View>

        <NeuCard dark={isDark} radius={16}>
          <View style={styles.cardInner}>
            <Text style={[styles.label, { color: t.ts }]}>SESSION</Text>
            <Text style={[styles.value, { color: t.tp }]}>
              {session ? `Signed in as ${session.user.email}` : "Not signed in"}
            </Text>
          </View>
        </NeuCard>

        {!session ? (
          <NeuCard dark={isDark} radius={16}>
            <View style={[styles.cardInner, { gap: 10 }]}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="email"
                placeholderTextColor={t.ts}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                style={inputStyle}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="password (min 6 chars)"
                placeholderTextColor={t.ts}
                autoCapitalize="none"
                secureTextEntry
                style={inputStyle}
              />
              <View style={styles.row}>
                <BounceButton style={{ flex: 1 }} onPress={busy ? undefined : signUp}>
                  <View style={[styles.btn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                    <Text style={styles.btnText}>Sign up</Text>
                  </View>
                </BounceButton>
                <BounceButton style={{ flex: 1 }} onPress={busy ? undefined : signIn}>
                  <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeu}>
                    <Text style={[styles.btnTextDark, { color: t.tp }]}>Sign in</Text>
                  </NeuCard>
                </BounceButton>
              </View>

              <Text style={[styles.hint, { color: t.ts, textAlign: "center" }]}>or</Text>
              <View style={styles.row}>
                <BounceButton style={{ flex: 1 }} onPress={busy ? undefined : () => oauth("google")}>
                  <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeuRow}>
                    <GoogleIcon size={18} />
                    <Text style={[styles.btnTextDark, { color: t.tp }]}>Google</Text>
                  </NeuCard>
                </BounceButton>
                <BounceButton style={{ flex: 1 }} onPress={busy ? undefined : () => oauth("apple")}>
                  <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeuRow}>
                    <Ionicons name="logo-apple" size={18} color={t.tp} />
                    <Text style={[styles.btnTextDark, { color: t.tp }]}>Apple</Text>
                  </NeuCard>
                </BounceButton>
              </View>
              <Text style={[styles.hint, { color: t.ts }]} selectable>
                Redirect URL (add to Supabase → Auth → URL Configuration):{"\n"}{oauthRedirectTo}
              </Text>
            </View>
          </NeuCard>
        ) : (
          <NeuCard dark={isDark} radius={16}>
            <View style={[styles.cardInner, { gap: 10 }]}>
              <BounceButton onPress={busy ? undefined : push}>
                <View style={[styles.btn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.btnText}>Push my data to cloud</Text>
                </View>
              </BounceButton>
              <BounceButton onPress={busy ? undefined : pull}>
                <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeuRow}>
                  <Ionicons name="cloud-download-outline" size={18} color={t.tp} />
                  <Text style={[styles.btnTextDark, { color: t.tp }]}>Pull cloud → device</Text>
                </NeuCard>
              </BounceButton>
              <BounceButton onPress={busy ? undefined : smartSync}>
                <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeuRow}>
                  <Ionicons name="sync-outline" size={18} color={ACCT} />
                  <Text style={[styles.btnTextDark, { color: t.tp }]}>Smart sync (first-login)</Text>
                </NeuCard>
              </BounceButton>
              <View style={styles.row}>
                <BounceButton style={{ flex: 1 }} onPress={busy ? undefined : refresh}>
                  <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeu}>
                    <Text style={[styles.btnTextDark, { color: t.tp }]}>Refresh counts</Text>
                  </NeuCard>
                </BounceButton>
                <BounceButton style={{ flex: 1 }} onPress={busy ? undefined : signOut}>
                  <NeuCard dark={isDark} radius={12} innerStyle={styles.btnNeu}>
                    <Text style={[styles.btnTextDark, { color: "#E53935" }]}>Sign out</Text>
                  </NeuCard>
                </BounceButton>
              </View>
            </View>
          </NeuCard>
        )}

        {counts && (
          <NeuCard dark={isDark} radius={16}>
            <View style={styles.cardInner}>
              <Text style={[styles.label, { color: t.ts }]}>IN THE CLOUD</Text>
              <Text style={[styles.value, { color: t.tp }]}>{counts.programs} programs</Text>
              <Text style={[styles.value, { color: t.tp }]}>{counts.workouts} workouts</Text>
              <Text style={[styles.value, { color: t.tp }]}>{counts.journal} journal entries</Text>
              <Text style={[styles.value, { color: t.tp }]}>{counts.customExercises} custom exercises</Text>
            </View>
          </NeuCard>
        )}

        {status ? (
          <Text style={[styles.status, { color: t.ts }]}>{status}</Text>
        ) : null}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title:     { fontFamily: FontFamily.bold, fontSize: 20 },
  cardInner: { padding: 16, gap: 4 },
  label:     { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1 },
  value:     { fontFamily: FontFamily.semibold, fontSize: 15, marginTop: 2 },
  input:     { fontFamily: FontFamily.regular, fontSize: 15, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  row:       { flexDirection: "row", gap: 10 },
  btn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  btnText:   { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  btnNeu:    { alignItems: "center", justifyContent: "center", paddingVertical: 13, minHeight: 46 },
  btnNeuRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, minHeight: 46 },
  btnTextDark: { fontFamily: FontFamily.bold, fontSize: 15 },
  status:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", marginTop: 4 },
  hint:      { fontFamily: FontFamily.regular, fontSize: 11, lineHeight: 16 },
});
