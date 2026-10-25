/**
 * Bottom sheet for choosing which artist to go to when a song or album has
 * multiple artists (collaborations). Opened from the `artistPicker` store.
 */
import { MenuGlassCardFrame, MenuGlassCardHeader } from '@/components/MenuGlassCard';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Modal, Pressable, ScrollView, Text } from 'react-native';

import { COVER, coverArtUrl } from '@/api/data';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { type ArtistTarget } from '@/lib/artistNav';
import { useArtistPicker } from '@/store/artistPicker';
import { fontSize, spacing, themed } from '@/theme';
import { Cover } from './Cover';

export function ArtistPickerSheet() {
  const artists = useArtistPicker((s) => s.artists);
  const session = useArtistPicker((s) => s.session);
  return artists ? <ArtistPickerContent key={session} artists={artists} session={session} /> : null;
}

function ArtistPickerContent({ artists, session }: { artists: ArtistTarget[]; session: number }) {
  const router = useRouter();
  const t = useT();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const closeNow = () => {
    const current = useArtistPicker.getState();
    if (!mounted.current || current.session !== session || !current.artists) return false;
    current.close();
    return true;
  };
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    true,
    closeNow,
    'card',
    session,
  );
  const close = () => dismiss(closeNow);

  const go = (id: string) => {
    dismiss(() => {
      if (closeNow()) router.push(`/artist/${id}`);
    });
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <MenuGlassCardFrame
        onClose={close}
        backdropStyle={backdropStyle}
        cardStyle={sheetStyle}
        onLayout={onSheetLayout}
      >
        <MenuGlassCardHeader title={t('Artists')} onClose={close} />
        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {artists.map((a) => (
            <Pressable
              key={a.id}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => go(a.id)}
            >
              <Cover uri={coverArtUrl(a.id, COVER.thumb)} size={48} rounded />
              <Text style={styles.name} numberOfLines={1}>
                {a.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </MenuGlassCardFrame>
    </Modal>
  );
}

const styles = themed((colors) => ({
  scroll: { flexShrink: 1, minHeight: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  name: { color: colors.text, fontSize: fontSize.md, flex: 1 },
}));
