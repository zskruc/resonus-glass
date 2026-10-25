/** Centered message for error or empty states, with optional retry. */
import { GlassPressable } from '@/components/glass';
import { Text, View } from 'react-native';

import { useT } from '@/i18n';
import { fontSize, radius, spacing, themed } from '@/theme';

export function Message({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{text}</Text>
      {onRetry ? (
        <GlassPressable variant="regular" style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>{t('Retry')}</Text>
        </GlassPressable>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => ({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    marginTop: spacing.xxl,
  },
  text: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
}));
