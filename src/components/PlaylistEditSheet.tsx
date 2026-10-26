/** Sheet to edit a playlist: cover, name, description, and visibility. */
import { GlassPressable, GlassSwitch } from '@/components/glass';
import Icon from '@/components/Icon';
import { MenuGlassCardFrame, MenuGlassCardHeader } from '@/components/MenuGlassCard';
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

export interface PlaylistEdit {
  name: string;
  comment: string;
  public: boolean;
}

interface Props {
  visible: boolean;
  initial: PlaylistEdit;
  coverUri?: string;
  /** Hides the public playlist toggle (e.g. in local mode, no server). */
  hidePublic?: boolean;
  /**
   * Server playlist ID: enables changing the cover with a local image
   * (Navidrome native API >= 0.61). Navidrome profiles only.
   */
  coverUploadId?: string;
  /**
   * Local profile playlist ID: enables changing the cover by copying the image
   * to the app's storage (no server involved).
   */
  localCoverId?: string;
  onCancel: () => void;
  onSave: (changes: PlaylistEdit) => void;
}

export function PlaylistEditSheet({
  visible,
  initial,
  coverUri,
  hidePublic,
  coverUploadId,
  localCoverId,
  onCancel,
  onSave,
}: Props) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [comment, setComment] = useState(initial.comment);
  const [isPublic, setIsPublic] = useState(initial.public);
  // Cover change (upload/copy, inline error, and password dialog): logic
  // shared with the cover viewer. Error is inline because a toast would be
  // hidden under this Modal.
  const cover = useServerCover({ coverUploadId, localCoverId });
  const { reset: resetCover } = cover;

  // Resets fields every time it opens.
  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setComment(initial.comment);
      setIsPublic(initial.public);
      resetCover();
    }
  }, [visible, initial.name, initial.comment, initial.public, resetCover]);

  const canSave = name.trim().length > 0;

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
          <MenuGlassCardHeader title={t('Edit playlist')} onClose={onCancel} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.coverWrap}>
              {cover.enabled ? (
                <>
                  <Pressable
                    onPress={() => void cover.pickAndUpload()}
                    disabled={cover.uploading}
                    accessibilityRole="button"
                    accessibilityLabel={t('Change cover')}
                    style={({ pressed }) => pressed && { opacity: 0.7 }}
                  >
                    <Cover uri={cover.pickedUri ?? coverUri} size={160} />
                    {cover.uploading ? (
                      <View style={styles.coverOverlay}>
                        <ActivityIndicator color={colors.onArtwork} />
                      </View>
                    ) : (
                      <View style={styles.coverBadges}>
                        <View collapsable={false} style={styles.coverBadge}>
                          <Icon name="camera" size={16} color={colors.onArtwork} />
                        </View>
                        <GlassPressable variant="prominent" tint={'rgba(0,0,0,0.65)'}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={t('Remove cover')}
                          onPress={() => void cover.removeCover()}
                          style={({ pressed }) => [styles.coverBadge, pressed && { opacity: 0.7 }]}
                        >
                          <Icon name="trash-outline" size={16} color={colors.onArtwork} />
                        </GlassPressable>
                      </View>
                    )}
                  </Pressable>
                  {cover.error ? <Text style={styles.coverError}>{cover.error}</Text> : null}
                </>
              ) : (
                <Cover uri={coverUri} size={160} />
              )}
            </View>

            <Text style={styles.label}>{t('Name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('Playlist name')}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>{t('Description')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={comment}
              onChangeText={setComment}
              placeholder={t('Add an optional description')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {hidePublic ? null : (
              <GlassPressable buttonMaterial={false} variant="regular" style={styles.switchRow} onPress={() => setIsPublic((v) => !v)}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchTitle}>{t('Public playlist')}</Text>
                  <Text style={styles.switchSub}>{t('Visible to other users on the server')}</Text>
                </View>
                <GlassSwitch
                  value={isPublic}
                  onValueChange={setIsPublic}
                  trackColor={{ true: colors.accent, false: colors.control }}
                  thumbColor={colors.knob}
                />
              </GlassPressable>
            )}
            <View style={styles.actions}>
              <GlassPressable onPress={onCancel} style={styles.action} accessibilityRole="button">
                <Text style={styles.headerAction}>{t('Cancel')}</Text>
              </GlassPressable>
              <GlassPressable variant="subtle" style={styles.action} accessibilityRole="button"
                disabled={!canSave}
                onPress={() => onSave({ name: name.trim(), comment: comment.trim(), public: isPublic })}
              >
                <Text style={[styles.headerAction, { color: colors.accent }, !canSave && styles.disabled]}>{t('Save')}</Text>
              </GlassPressable>
            </View>
          </ScrollView>
        </MenuGlassCardFrame>
      </KeyboardAvoidingView>

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
  coverError: {
    color: colors.danger,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    textAlign: 'center',
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
  multiline: { minHeight: 90 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: 'rgba(127,127,127,0.07)',
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  switchInfo: { flex: 1 },
  switchTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  switchSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
