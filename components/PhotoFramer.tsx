// Move and Scale (user request, 2026-10-29): a picked photo behind a circle (a
// profile or a group's photo) or a rounded square (a custom exercise's), dragged
// and pinched into place, and Choose keeps what the frame holds. It stands in
// for iOS's own, which came only with the old, slow library picker
// (lib/photoPicker.ts says why).
//
// Mounted once, over every screen, from app/_layout.tsx (PhotoFramerHost), and
// asked for through lib/photoPicker.ts:pickSquarePhoto. It isn't a Modal: iOS
// drops a presentation made while the picker is still sliding away, and a
// screen mounts one Modal at most (a group's page has its member sheet). Drawn
// in the root view instead, it's already there as the picker slides off it, and
// it covers the workout bar and the rest pill.
//
// The photo moves on the UI thread (Reanimated); the fingers are read through
// the view's own touch responder, which, like the PanResponder the app's other
// drags use, sees every finger, but needs nothing made during render. Past its
// limits the photo gives less and less, and settles back when let go. It
// leaves by sliding down, never a fade: its buttons are glass, which draws
// wrongly under any opacity.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator, BackHandler, Keyboard, StyleSheet, Text, View,
  useWindowDimensions, type NativeTouchEvent,
} from "react-native";
import Animated, { SlideOutDown, cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Image, type ImageLoadEventData } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassButton from "./GlassButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, ON_FILL } from "../constants/theme";
import { darkGlow, pillGlow, PILL_H_SM } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import {
  getFrameRequest, renderSquarePhoto, subscribeFrameRequest,
  type FrameRequest, type SquarePhotoKind,
} from "../lib/photoPicker";
import { MAX_ZOOM, clamp, coverSize, frameCrop, panLimit, rubberBand } from "../utils/photoFrame";

/** The frame's gap to the screen's sides. */
const FRAME_GUTTER = 16;
/** A custom exercise's photo is a rounded square on its page, 20pt corners at
 *  up to 340pt wide (app/exercise-summary.tsx). */
const SQUARE_RADIUS = 20;
/** How much of the page's colour lies over the photo outside the frame. */
const SCRIM_OPACITY = 0.78;
/** The least a pinch takes the zoom to before its limits hold it back, so two
 *  fingers brought together never shrink it to nothing. */
const MIN_PINCH = 0.05;
/** The photo settling back inside its limits once let go. */
const SETTLE = { damping: 30, stiffness: 300, overshootClamping: true };

type Place = { k: number; tx: number; ty: number };

type Touches = readonly NativeTouchEvent[];

const middle = (touches: Touches) => ({
  x: touches.reduce((sum, t) => sum + t.pageX, 0) / touches.length,
  y: touches.reduce((sum, t) => sum + t.pageY, 0) / touches.length,
});

const spread = (touches: Touches) =>
  touches.length > 1 ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0;

/** The frame's outline, centred on (cx, cy), `side` across. */
function framePath(shape: SquarePhotoKind["shape"], cx: number, cy: number, side: number): string {
  const r = side / 2;
  if (shape === "circle") return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${side} 0a${r} ${r} 0 1 0 ${-side} 0Z`;
  const [x0, y0, x1, y1, c] = [cx - r, cy - r, cx + r, cy + r, SQUARE_RADIUS];
  return `M${x0 + c} ${y0}H${x1 - c}A${c} ${c} 0 0 1 ${x1} ${y0 + c}V${y1 - c}A${c} ${c} 0 0 1 ${x1 - c} ${y1}`
    + `H${x0 + c}A${c} ${c} 0 0 1 ${x0} ${y1 - c}V${y0 + c}A${c} ${c} 0 0 1 ${x0 + c} ${y0}Z`;
}

/** Mounted once, in app/_layout.tsx, after everything it has to cover. */
export function PhotoFramerHost() {
  const request = useSyncExternalStore(subscribeFrameRequest, getFrameRequest);
  return request ? <PhotoFramer key={request.uri} request={request} /> : null;
}

function PhotoFramer({ request }: { request: FrameRequest }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const frame = width - FRAME_GUTTER * 2;
  const mid = { x: width / 2, y: height / 2 };

  // The photo's size as shown: the picker's, unless what expo-image loaded
  // disagrees (the picker couldn't tell, or had it on its side).
  const [size, setSize] = useState(() =>
    request.width > 0 && request.height > 0 ? { w: request.width, h: request.height } : { w: 1, h: 1 });
  const cover = coverSize(size.w, size.h, frame);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const k = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: k.value }],
  }));

  // Where the fingers have taken the photo, limits aside, and where it's drawn:
  // the same until a limit holds it back. The fingers work from the first, so
  // a finger lifted or added mid-stretch doesn't make it jump.
  const raw = useRef<Place>({ k: 1, tx: 0, ty: 0 });
  const shown = useRef<Place>({ k: 1, tx: 0, ty: 0 });
  // The fingers' start: how many, their middle (from the frame's centre) and
  // spread, and where the photo was then.
  const start = useRef({ n: 0, fx: 0, fy: 0, spread: 0, k: 1, tx: 0, ty: 0 });

  const show = (p: Place) => {
    shown.current = p;
    k.set(p.k);
    tx.set(p.tx);
    ty.set(p.ty);
  };
  const begin = (touches: Touches) => {
    const c = middle(touches);
    start.current = { n: touches.length, fx: c.x - mid.x, fy: c.y - mid.y, spread: spread(touches), ...raw.current };
  };
  const follow = (touches: Touches) => {
    if (touches.length === 0) return;
    // A finger added or lifted: carry on from here with the new count.
    if (touches.length !== start.current.n) { begin(touches); return; }
    const s = start.current;
    const c = middle(touches);
    const pinch = s.spread > 0 ? spread(touches) / s.spread : 1;
    const rk = Math.max(MIN_PINCH, s.k * pinch);
    // The point under the fingers stays under them as it zooms.
    const r = rk / s.k;
    raw.current = { k: rk, tx: c.x - mid.x - (s.fx - s.tx) * r, ty: c.y - mid.y - (s.fy - s.ty) * r };
    const nk = rubberBand(rk, 1, MAX_ZOOM, 1);
    const lim = panLimit(cover, frame, nk);
    show({
      k: nk,
      tx: rubberBand(raw.current.tx, -lim.x, lim.x, frame),
      ty: rubberBand(raw.current.ty, -lim.y, lim.y, frame),
    });
  };
  const settle = () => {
    start.current.n = 0;
    const nk = clamp(shown.current.k, 1, MAX_ZOOM);
    const lim = panLimit(cover, frame, nk);
    const p = { k: nk, tx: clamp(shown.current.tx, -lim.x, lim.x), ty: clamp(shown.current.ty, -lim.y, lim.y) };
    raw.current = p;
    shown.current = p;
    k.set(withSpring(p.k, SETTLE));
    tx.set(withSpring(p.tx, SETTLE));
    ty.set(withSpring(p.ty, SETTLE));
  };

  useEffect(() => {
    Keyboard.dismiss();
    // Android's Back cancels, as Cancel does, rather than leaving the page under it.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busyRef.current) request.done(null);
      return true;
    });
    return () => sub.remove();
  }, [request]);

  const onLoad = (e: ImageLoadEventData) => {
    const { width: w, height: h } = e.source;
    if (!(w > 0 && h > 0) || Math.abs(w / h - size.w / size.h) < 0.01) return;
    // Another shape than the picker said: start it again, just filling the frame.
    setSize({ w, h });
    raw.current = { k: 1, tx: 0, ty: 0 };
    show(raw.current);
  };

  const choose = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { k: zoom, tx: x, ty: y } = shown.current;
      request.done(await renderSquarePhoto(request.uri, size.w, size.h, frameCrop(cover, zoom, x, y), request.kind.px));
    } catch (e) {
      request.fail(e);
    }
  };

  const cancel = () => {
    if (!busyRef.current) request.done(null);
  };

  const outline = framePath(request.kind.shape, mid.x, mid.y, frame);

  return (
    <Animated.View
      exiting={SlideOutDown.duration(260)}
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: t.bg }]}
      accessibilityViewIsModal
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.photo,
          { left: mid.x - cover.w / 2, top: mid.y - cover.h / 2, width: cover.w, height: cover.h },
          photoStyle,
        ]}
      >
        {/* Decoded whole, so it stays sharp zoomed in: by default expo-image
            decodes to the view's size, and the zoom is only a transform. */}
        <Image
          source={{ uri: request.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          allowDownscaling={false}
          transition={150}
          onLoad={onLoad}
        />
      </Animated.View>

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width={width} height={height}>
          <Path d={`M0 0H${width}V${height}H0Z${outline}`} fill={t.bg} fillOpacity={SCRIM_OPACITY} fillRule="evenodd" />
          <Path d={outline} fill="none" stroke={t.div} strokeWidth={1} />
        </Svg>
      </View>

      {/* A finger anywhere on the page moves the photo, two zoom it. The
          view's own responder: every finger is in a move's `touches`. */}
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => !busyRef.current}
        onMoveShouldSetResponder={() => !busyRef.current}
        onResponderTerminationRequest={() => false}
        onResponderGrant={e => {
          // Caught while settling: from where it is now.
          cancelAnimation(k);
          cancelAnimation(tx);
          cancelAnimation(ty);
          raw.current = { k: k.get(), tx: tx.get(), ty: ty.get() };
          shown.current = raw.current;
          begin(e.nativeEvent.touches);
        }}
        onResponderMove={e => follow(e.nativeEvent.touches)}
        onResponderRelease={settle}
        onResponderTerminate={settle}
        accessible
        accessibilityLabel="Photo"
        accessibilityHint="Drag to move it, pinch to zoom"
      />

      <View pointerEvents="none" style={[styles.titleRow, { top: insets.top + 14 }]}>
        <Text style={[styles.title, { color: t.tp }]}>Move and Scale</Text>
      </View>

      <View pointerEvents="box-none" style={[styles.actions, { bottom: insets.bottom + 16 }]}>
        <GlassButton
          pill
          size={PILL_H_SM}
          onPress={cancel}
          disabled={busy}
          contentStyle={styles.actionContent}
          accessibilityLabel="Cancel"
        >
          <Text style={[styles.actionText, { color: t.tp }]}>Cancel</Text>
        </GlassButton>
        <GlassButton
          pill
          size={PILL_H_SM}
          tint={ACCT}
          onPress={() => void choose()}
          contentStyle={styles.actionContent}
          solidStyle={[styles.chooseGlow, darkGlow(styles.chooseGlow, isDark)]}
          accessibilityLabel="Choose"
          accessibilityState={{ busy }}
        >
          {busy
            ? <ActivityIndicator color={ON_FILL} />
            : <Text style={[styles.actionText, { color: ON_FILL }]}>Choose</Text>}
        </GlassButton>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Over the workout bar and the rest pill, which come before it in the root view.
  root: { zIndex: 10 },
  photo: { position: "absolute" },
  titleRow: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  title: { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.2 },
  actions: {
    position: "absolute", left: FRAME_GUTTER, right: FRAME_GUTTER,
    flexDirection: "row", justifyContent: "space-between",
  },
  actionContent: { minWidth: 116, paddingHorizontal: 22 },
  actionText: { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 0.2 },
  chooseGlow: pillGlow(ACCT, 0.35),
});
