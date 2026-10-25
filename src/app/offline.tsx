/** Offline mode: initial setup to choose the music source. */
import { GlassPressable, GlassScreen as SafeAreaView } from '@/components/glass';
import Icon from '@/components/Icon';
import { Text, View } from 'react-native';


import {
  ensureAudioPermission,
  pickFolder,
} from '@/lib/localLibrary';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, themed, useTheme, tracking } from '@/theme';

export default function OfflineScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);

  async function chooseDevice() {
    const ok = await ensureAudioPermission();
    if (!ok) {
      toast(t('We need permission to read your device music.'));
      return;
    }
    void setSource({ mode: 'device' });
  }

  async function chooseFolder() {
    const uri = await pickFolder();
    if (uri) void setSource({ mode: 'folder', uris: [uri] });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t('Offline mode')}</Text>
        <GlassPressable variant="subtle"
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('Exit')}
          onPress={() => logout()}
        >
          <Icon name="exit-outline" size={24} color={colors.textSecondary} />
        </GlassPressable>
      </View>
      <View style={styles.setup}>
        <Text style={styles.setupTitle}>{t('Where should we get your music?')}</Text>

        <GlassPressable variant="regular" style={styles.option} onPress={chooseFolder}>
          <Icon name="folder-outline" size={28} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>{t('Choose a folder (recommended)')}</Text>
            <Text style={styles.optionSub}>{t('Only the music in the folder you choose.')}</Text>
          </View>
          <Icon name="chevron-forward" size={20} color={colors.textMuted} />
        </GlassPressable>

        <GlassPressable variant="regular" style={styles.option} onPress={chooseDevice}>
          <Icon name="phone-portrait-outline" size={28} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>{t('Scan the whole phone')}</Text>
            <Text style={styles.optionSub}>{t('All the music on your device.')}</Text>
          </View>
          <Icon name="chevron-forward" size={20} color={colors.textMuted} />
        </GlassPressable>
      </View>
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  heading: { color: colors.text, fontSize: fontSize.xxl, letterSpacing: tracking.display, fontWeight: '400' },
  setup: { paddingHorizontal: spacing.lg, gap: spacing.md, marginTop: spacing.lg },
  setupTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  optionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  optionSub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
}));
