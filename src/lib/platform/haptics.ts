// Haptic feedback on Android/iOS via tauri-plugin-haptics. A silent no-op on desktop, where
// the plugin is not registered.
import { impactFeedback, selectionFeedback } from '@tauri-apps/plugin-haptics';

const isMobile =
  typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

export function tapHaptic(strength: 'light' | 'medium' | 'heavy' = 'light') {
  if (isMobile) impactFeedback(strength).catch(() => {});
}

export function tickHaptic() {
  if (isMobile) selectionFeedback().catch(() => {});
}
