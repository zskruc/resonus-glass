/** A local draft preserves deletion, whitespace and Chinese IME composition. */
import { useEffect, useRef, useState } from 'react';
import { DockScrollView } from '@/components/DockScrollView';
import { Field, SettingsPage, settingsStyles, TextRow } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { greetingHours } from '@/i18n/languages';
import { HOME_TITLE_MAX, normalizeHomeTitle, resolveHomeTitle } from '@/lib/homeTitle';
import { useSettings } from '@/store/settings';
import { profileScopeId } from '@/store/auth';
import { useTheme } from '@/theme';

export default function HomeTitleSettings() {
  useTheme();
  const t = useT();
  const saved = useSettings((state) => state.customHomeTitle);
  const setTitle = useSettings((state) => state.setCustomHomeTitle);
  const showGreeting = useSettings((state) => state.showGreeting);
  const customGreeting = useSettings((state) => state.customGreeting);
  const language = useSettings((state) => state.language);
  const [draft, setDraft] = useState(saved);
  const draftRef = useRef(saved);
  const editingScope = useRef(profileScopeId());
  useEffect(() => {
    draftRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Imported/profile settings replace an external saved value; keystrokes stay in the local draft.
    setDraft(saved);
  }, [saved]);
  useEffect(() => () => {
    // Navigation can unmount a focused native input before its end-edit event
    // arrives. Save the last draft without writing it into another profile.
    if (profileScopeId() !== editingScope.current) return;
    const title = normalizeHomeTitle(draftRef.current);
    if (useSettings.getState().customHomeTitle !== title) useSettings.getState().setCustomHomeTitle(title);
  }, []);
  const [morning, afternoon, evening] = greetingHours(language);
  const hour = new Date().getHours();
  const automaticGreeting = hour >= morning && hour < afternoon ? t('Good morning')
    : hour >= afternoon && hour < evening ? t('Good afternoon')
      : hour >= evening ? t('Good evening') : t('Good night');
  const greeting = customGreeting.trim() || automaticGreeting;
  const commit = (text: string) => {
    if (profileScopeId() !== editingScope.current) return;
    const title = normalizeHomeTitle(text);
    draftRef.current = title;
    setTitle(title);
    setDraft(title);
  };

  return (
    <SettingsPage title={t('Home title')}>
      <DockScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
        <TextRow label={t('Home title')}
          description={t('Changes only the large Home heading. A custom title replaces the greeting. Leave it empty to restore your greeting settings or the translated Home title. Saved when you finish editing.')}
          value={draft} placeholder={t('Home')} maxLength={HOME_TITLE_MAX}
          onChange={(text) => { draftRef.current = text; setDraft(text); }} onEndEditing={commit} />
        <Field label={t('Title preview')} value={resolveHomeTitle(draft, showGreeting, greeting, t('Home'))} />
      </DockScrollView>
    </SettingsPage>
  );
}
