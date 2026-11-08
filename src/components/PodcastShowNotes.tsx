import { memo } from 'react';
import { Text, View } from 'react-native';
import type { PodcastNoteBlock } from '@/lib/podcastShowNotes';
import { colors, fontSize, spacing, themed } from '@/theme';

/** Only native text spans: publisher HTML cannot execute code or load media. */
export const PodcastShowNote = memo(function PodcastShowNote({ block, onLink, onTimestamp, disabled = false }: {
  block: PodcastNoteBlock; onLink: (url: string) => void; onTimestamp: (seconds: number) => void; disabled?: boolean;
}) {
  return <View style={[styles.block, block.kind === 'quote' && styles.quote]}>
    <Text selectable style={[styles.text, block.kind === 'heading' && styles.heading]}>
      {block.kind === 'listItem' ? '• ' : ''}
      {block.spans.map((span, index) => <Text key={index} accessibilityRole={span.href ? 'link' : span.startSec !== undefined ? 'button' : undefined}
        onPress={!disabled && (span.href || span.startSec !== undefined) ? () => {
          if (span.href) onLink(span.href); else if (span.startSec !== undefined) onTimestamp(span.startSec);
        } : undefined}
        style={[span.bold && { fontWeight: '600' }, span.italic && { fontStyle: 'italic' },
          (span.href || span.startSec !== undefined) && { color: colors.accent, textDecorationLine: span.href ? 'underline' : 'none' }]}>{span.text}</Text>)}
    </Text>
  </View>;
});
const styles = themed((palette) => ({ block: { marginBottom: spacing.md }, text: { color: palette.text, fontSize: fontSize.md, lineHeight: 25 },
  heading: { fontSize: fontSize.lg, lineHeight: 29, fontWeight: '600' },
  quote: { borderLeftWidth: 2, borderLeftColor: palette.textMuted, paddingLeft: spacing.md },
}));
