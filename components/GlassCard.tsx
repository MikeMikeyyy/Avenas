import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { StyleSheet, View, ViewStyle } from 'react-native';

export interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function GlassCard({ children, style }: GlassCardProps) {
  if (isGlassEffectAPIAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" style={[styles.card, style]}>
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[styles.shadow, style]}>
      <BlurView intensity={60} tint="light" style={styles.blur}>
        {children}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  blur: {
    borderRadius: 20,
    overflow: 'hidden',
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.95)',
  },
  card: {
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.95)',
  },
});
