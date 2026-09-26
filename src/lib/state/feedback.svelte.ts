// Visual state set from outside a widget's own gestures: pads lit by incoming OSC or by a
// peer, and flashes of trigger buttons and pads. It lives here rather than in the components
// because a widget on another desk isn't mounted, yet must show the right state when you come
// back to it. The components read and write it, so local and remote changes agree.

export const feedback = $state({
  /** widgetId → pad number → lit (held, or latched in toggle mode). */
  padLit: {} as Record<string, Record<number, boolean>>,
  /** widgetId → pad number → flash counter (a trigger pad hit from outside). */
  padFlash: {} as Record<string, Record<number, number>>,
  /** widgetId → flash counter (a trigger button fired from outside). */
  flash: {} as Record<string, number>,
});

export function setPadLit(widgetId: string, pad: number, on: boolean) {
  if (!feedback.padLit[widgetId]) feedback.padLit[widgetId] = {};
  feedback.padLit[widgetId][pad] = on;
}

export function flashPad(widgetId: string, pad: number) {
  if (!feedback.padFlash[widgetId]) feedback.padFlash[widgetId] = {};
  const flashes = feedback.padFlash[widgetId];
  flashes[pad] = (flashes[pad] ?? 0) + 1;
}

export function flashWidget(widgetId: string) {
  feedback.flash[widgetId] = (feedback.flash[widgetId] ?? 0) + 1;
}

/** Drops everything about a widget that was removed. */
export function forgetFeedback(widgetId: string) {
  delete feedback.padLit[widgetId];
  delete feedback.padFlash[widgetId];
  delete feedback.flash[widgetId];
}
