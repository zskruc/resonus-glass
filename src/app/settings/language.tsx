/** Language picker — list with a radio on the active language. */
import { DockScrollView } from '@/components/DockScrollView';
import { Linking, Text } from 'react-native';

import { SelectList, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { LANGUAGES } from '@/i18n/languages';
import { REPOSITORY_URL, SOURCE_BRANCH } from '@/lib/project';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

// How to contribute a translation, rather than the folder of locale files: the
// guide explains what to do with them. The help text follows the app language;
// language names stay in their own language so each option is recognizable.
const TRANSLATIONS_URL = `${REPOSITORY_URL}/blob/${SOURCE_BRANCH}/TRANSLATING.md`;

// Derived from the single source: a row added there appears here by itself.
// Sorted once, and by a fixed collation: with no locale given, `localeCompare`
// follows the app's own language, which changes as soon as one is picked. In
// Russian, Cyrillic sorts before Latin, so choosing Русский jumped it and
// Українська to the top of the list under the finger.
const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l.code, label: l.name })).sort((a, b) =>
  a.label.localeCompare(b.label, 'en'),
);

export default function LanguageSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);

  return (
    <SettingsPage title={t('Language')}>
      <DockScrollView contentContainerStyle={settingsStyles.content}>
        <SelectList
          options={LANGUAGE_OPTIONS}
          value={language}
          onChange={setLanguage}
          collapsible={false}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Translations')}</Text>
        <Text style={settingsStyles.sectionDescription}>
          {t("Don't see your language, or want to improve an existing one? You can help by contributing a translation on GitHub. Pull requests are welcome.")}
        </Text>
        <SettingRow
          icon="globe-outline"
          label={t('Help translate')}
          onPress={() => Linking.openURL(TRANSLATIONS_URL)}
        />
      </DockScrollView>
    </SettingsPage>
  );
}
