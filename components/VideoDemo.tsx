// Inline video player for a custom exercise's saved demo clip.
//
// Mount this only when there's a `uri` (it calls `useVideoPlayer`, which needs a
// source). It renders a square card with the native transport controls, so the
// user sees the first frame with a centre play button and taps to play. Native
// controls also give scrubbing and fullscreen for free.

import { View, StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

interface Props {
  /** Local file URI of the saved demo video. */
  uri: string;
  /** Square side length in px (matches the hero photo above it). */
  size: number;
  /** Corner radius. Default 16. */
  radius?: number;
  /** Play the clip with no sound. Default false (audio on). */
  muted?: boolean;
}

export default function VideoDemo({ uri, size, radius = 16, muted = false }: Props) {
  // Created once on mount with the clip as its source; stays paused until the
  // user taps play (expo-video does not autoplay).
  const player = useVideoPlayer(uri, p => {
    p.loop = false;
    p.muted = muted;
  });

  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: radius }]}>
      <VideoView
        player={player}
        style={{ width: size, height: size }}
        // `contain` letterboxes so portrait and landscape clips both show whole.
        contentFit="contain"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden", backgroundColor: "#000" },
});
