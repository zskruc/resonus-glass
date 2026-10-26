/** Original native geometry for the reviewed AMLL control arrangements. */
export type AmllTransportAction = 'shuffle' | 'previous' | 'toggle' | 'next' | 'repeat';
export type AmllBottomAction = 'lyrics' | 'output' | 'queue';

const valid = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

export function amllPlayerControlLayout({ width, viewportHeight, horizontal, showVolume, fontScale = 1 }: {
  width: number;
  viewportHeight: number;
  horizontal: boolean;
  showVolume: boolean;
  fontScale?: number;
}) {
  const availableWidth = valid(width, 1);
  const height = valid(viewportHeight, 640);
  const scale = Math.max(1, Math.min(2.5, valid(fontScale, 1)));
  const actions: AmllTransportAction[] = horizontal
    ? ['shuffle', 'previous', 'toggle', 'next', 'repeat'] : ['previous', 'toggle', 'next'];
  const contentWidth = Math.max(availableWidth, actions.length * 44);
  const transportButtonSize = horizontal
    ? Math.max(44, Math.min(96, contentWidth * .18))
    : Math.max(44, Math.min(112, height * .10, contentWidth * .26));
  const transportPadding = horizontal ? 0 : Math.min(contentWidth * .02, height * .02,
    Math.max(0, (contentWidth - actions.length * 44) / 2));
  const transportPaddingTop = horizontal ? 0 : height * .02;
  const rowWidth = contentWidth - transportPadding * 2;
  const spare = Math.max(0, rowWidth - actions.length * transportButtonSize);
  const gap = spare / (horizontal ? actions.length - 1 : actions.length + 1);
  const slots = actions.map((action, index) => ({
    action,
    left: transportPadding + (horizontal ? 0 : gap) + index * (transportButtonSize + gap),
    size: transportButtonSize,
  }));
  // The portrait big-control row has its own glyph scale, independent of the
  // compact horizontal breakpoint sizes. Touch bounds remain at least 44dp.
  const skipGlyphSize = !horizontal ? (availableWidth <= 480 ? 44 : 55)
    : height <= 512 ? 24 : height <= 768 ? 34 : height <= 1080 ? 44 : 66;
  const playGlyphSize = !horizontal ? (availableWidth <= 480 ? 48 : 68)
    : height <= 512 ? 22 : height <= 768 ? 32 : height <= 1080 ? 44 : 78;
  const progressHeight = 44 + Math.ceil(16 * scale);
  const transportHeight = Math.ceil(transportButtonSize + transportPaddingTop);
  const auxiliaryHeight = horizontal ? 0 : 48;
  const volumeHeight = showVolume ? 44 : 0;
  const volumeBottomPadding = showVolume && !horizontal ? height <= 512 ? 16 : height <= 768 ? 32 : 64 : 0;
  return {
    height: progressHeight + transportHeight + auxiliaryHeight + volumeHeight + volumeBottomPadding,
    contentWidth, scrollable: contentWidth > availableWidth,
    progressHeight, transportHeight, transportButtonSize, transportPaddingTop,
    skipGlyphSize, playGlyphSize, auxiliaryHeight, volumeHeight, volumeBottomPadding, slots,
    rows: horizontal ? ['progress', 'transport', ...(showVolume ? ['volume'] : [])]
      : ['progress', 'transport', 'auxiliary', ...(showVolume ? ['volume'] : [])],
  };
}

/** Source order is physical: landscape output at left, lyrics/queue at right. */
export function amllBottomActionLayout(width: number, horizontal: boolean) {
  const availableWidth = valid(width, 1);
  const contentWidth = Math.max(availableWidth, horizontal ? 176 : 144);
  const size = 48;
  const gap = horizontal ? 32 : (contentWidth - size * 3) / 4;
  const slots: { action: AmllBottomAction; left: number; size: number }[] = horizontal ? [
    { action: 'output', left: 0, size },
    { action: 'lyrics', left: contentWidth - size * 2 - gap, size },
    { action: 'queue', left: contentWidth - size, size },
  ] : ['lyrics', 'output', 'queue'].map((action, index) => ({
    action: action as AmllBottomAction, left: gap + index * (size + gap), size,
  }));
  return { contentWidth, scrollable: contentWidth > availableWidth, height: size, slots };
}

export function amllMoreButtonSize(viewportWidth: number, viewportHeight: number) {
  const width = valid(viewportWidth, 360);
  const height = valid(viewportHeight, 640);
  return width <= 1000 ? Math.max(32, Math.min(width * .05, height * .04)) : Math.max(24, height * .035);
}
