/** Sheet to create or edit a radio station: name, URL, and optional website. */
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { MenuGlassCardFrame, MenuGlassCardHeader } from '@/components/MenuGlassCard';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { useServerCover } from '@/hooks/useServerCover';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

export interface RadioEdit {
  name: string;
  streamUrl: string;
  homePageUrl: string;
}

interface Props {
  visible: boolean;
  /** Initial values (for editing); empty for creation. */
  initial: RadioEdit;
  /** true if editing an existing station (changes the title). */
  editing: boolean;
  /**
   * Station id, when it already exists and the profile can upload covers
   * (Navidrome): the chosen image goes straight to the server. When creating
   * there's no id yet, so it stays "pending" and the parent uploads it once
   * the server assigns one.
   */
  coverId?: string;
  /** The station's current image on the server. */
  serverCoverUri?: string;
  /** The profile can change station covers (Navidrome only). When it can't,
   *  the image is still shown, just not editable. */
  coverEditable?: boolean;
  onCancel: () => void;
  onSave: (changes: RadioEdit, pendingCoverUri?: string) => void;
}

export function RadioEditSheet({
  visible,
  initial,
  editing,
  coverId,
  serverCoverUri,
  coverEditable,
  onCancel,
  onSave,
}: Props) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [streamUrl, setStreamUrl] = useState(initial.streamUrl);
  const [homePageUrl, setHomePageUrl] = useState(initial.homePageUrl);

  // The cover lives on the server, so it's the same for every client and for
  // Navidrome's own web UI. Editing an existing station uploads right away;
  // while creating there's no id yet, so the pick waits in `pendingCover` and
  // the parent uploads it once the server hands out the id.
  const cover = useServerCover({ kind: 'radio', coverUploadId: coverId });
  const { reset: resetCover } = cover;
  const [pendingCover, setPendingCover] = useState<string | null>(null);
  const coverBusy = cover.uploading;
  // `pickedUri` is the image just uploaded: shown right away instead of
  // waiting for the server to re-serve it under the same URL.
  const shownCover = cover.pickedUri ?? (coverId ? serverCoverUri : (pendingCover ?? undefined));
  const canRemove = !!coverEditable && (coverId ? !!shownCover : !!pendingCover);

  async function pickCover() {
    if (coverId) {
      await cover.pickAndUpload();
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return;
    setPendingCover(asset.uri);
  }

  async function clearCover() {
    if (!coverId) {
      setPendingCover(null);
      return;
    }
    await cover.removeCover();
  }

  // Resets fields every time it opens.
  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setStreamUrl(initial.streamUrl);
      setHomePageUrl(initial.homePageUrl);
      setPendingCover(null);
      resetCover();
    }
  }, [visible, initial.name, initial.streamUrl, initial.homePageUrl, resetCover]);

  const urlOk = /^https?:\/\//i.test(streamUrl.trim());
  const showUrlError = streamUrl.trim().length > 0 && !urlOk;
  const canSave = name.trim().length > 0 && urlOk;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={cover.askPassword ? cover.cancelPassword : onCancel}
    >
      <KeyboardAvoidingView
        style={styles.modal}
        behavior={Platform.OS === 'ios' ? 'height' : undefined}
      >
        <MenuGlassCardFrame maxWidth={384} onClose={onCancel}>
          <MenuGlassCardHeader title={editing ? t('Edit station') : t('Add station')} onClose={onCancel} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Nothing to show and no way to add one: skip it entirely. */}
            {coverEditable || shownCover ? (
            <View style={styles.coverWrap}>
              <Pressable
                onPress={() => void pickCover()}
                disabled={coverBusy || !coverEditable}
                accessibilityRole="button"
                accessibilityLabel={t('Change cover')}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                <Cover uri={shownCover} size={160} placeholderIcon="radio" />
                {coverBusy ? (
                  <View style={styles.coverOverlay}>
                    <ActivityIndicator color={colors.onArtwork} />
                  </View>
                ) : !coverEditable ? null : (
                  <View style={styles.coverBadges}>
                    <View collapsable={false} style={styles.coverBadge}>
                      <Icon name="camera" size={16} color={colors.onArtwork} />
                    </View>
                    {canRemove ? (
                      <GlassPressable variant="prominent" tint={'rgba(0,0,0,0.65)'}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={t('Remove cover')}
                        onPress={() => void clearCover()}
                        style={({ pressed }) => [styles.coverBadge, pressed && { opacity: 0.7 }]}
                      >
                        <Icon name="trash-outline" size={16} color={colors.onArtwork} />
                      </GlassPressable>
                    ) : null}
                  </View>
                )}
              </Pressable>
              {cover.error ? <Text style={styles.coverError}>{cover.error}</Text> : null}
            </View>
            ) : null}

            <Text style={styles.label}>{t('Name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('Station name')}
              placeholderTextColor={colors.textMuted}
              autoFocus
            />

            <Text style={styles.label}>{t('Stream URL')}</Text>
            <TextInput
              style={styles.input}
              value={streamUrl}
              onChangeText={setStreamUrl}
              placeholder="https://…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
            />
            {showUrlError ? (
              <Text style={styles.error}>
                {t('The stream URL must start with http:// or https://')}
              </Text>
            ) : null}

            <Text style={styles.label}>{t('Website (optional)')}</Text>
            <TextInput
              style={styles.input}
              value={homePageUrl}
              onChangeText={setHomePageUrl}
              placeholder="https://…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
            />
            <View style={styles.actions}>
              <GlassPressable onPress={onCancel} style={styles.action} accessibilityRole="button">
                <Text style={styles.headerAction}>{t('Cancel')}</Text>
              </GlassPressable>
              <GlassPressable variant="subtle" style={styles.action} accessibilityRole="button"
                disabled={!canSave}
                onPress={() =>
                  onSave(
                    {
                      name: name.trim(),
                      streamUrl: streamUrl.trim(),
                      homePageUrl: homePageUrl.trim(),
                    },
                    coverId ? undefined : (pendingCover ?? undefined),
                  )
                }
              >
                <Text
                  style={[styles.headerAction, { color: colors.accent }, !canSave && styles.disabled]}
                >
                  {t('Save')}
                </Text>
              </GlassPressable>
            </View>
          </ScrollView>
        </MenuGlassCardFrame>
      </KeyboardAvoidingView>

      {/* Profiles created before the password was stored: uploading needs
          Navidrome's own API, which asks for it. */}
      <Dialog
        inline
        visible={visible && cover.askPassword}
        title={t('Confirm your password')}
        message={t('Your password is needed to upload images and will be stored securely.')}
        input={{ placeholder: t('Password'), secure: true }}
        confirmLabel={t('Save')}
        onCancel={cover.cancelPassword}
        onConfirm={(value) => void cover.confirmPassword(value)}
      />
    </Modal>
  );
}

const styles = themed((colors) => ({
  modal: { flex: 1 },
  scroll: { flexShrink: 1, minHeight: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  action: { minHeight: 44, minWidth: 68, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  headerAction: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
  disabled: { color: colors.textMuted },
  content: { paddingBottom: spacing.xs, gap: spacing.sm },
  coverWrap: { alignItems: 'center', marginBottom: spacing.sm },
  // Inline, not a toast: a toast would be hidden under this Modal.
  coverError: {
    color: colors.danger,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
    borderRadius: radius.md,
  },
  coverBadges: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // Denser than `scrim`: a 16 px icon has less of the cover to lift itself off.
  coverBadge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.pill,
    padding: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: 'rgba(127,127,127,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.xs },
}));
