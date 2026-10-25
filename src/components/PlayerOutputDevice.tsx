import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { useMediaControls } from '@/hooks/useMediaControls';
import { useT } from '@/i18n';
import type { SystemRouteKind } from '@/lib/mediaControls';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

function routeIcon(kind: SystemRouteKind): keyof typeof Icon.glyphMap {
  switch (kind) {
    case 'headphones': return 'headset-outline';
    case 'bluetooth': return 'bluetooth-outline';
    case 'speaker': return 'phone-portrait-outline';
    case 'external': return 'volume-high-outline';
    default: return 'radio-outline';
  }
}

/** Local system route beneath the output button; remote output labels stay explicit. */
export function PlayerOutputDevice({
  onPress,
  remoteName,
  tint,
  activeTint,
  style,
  active = true,
}: {
  onPress: () => void;
  remoteName?: string | null;
  tint: string;
  activeTint?: string;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
}) {
  const t = useT();
  const route = useMediaControls(active);
  const label = remoteName || route.routeName || (
    route.routeKind === 'speaker' ? t('This phone')
      : route.routeKind === 'headphones' ? t('Headphones')
        : route.routeKind === 'bluetooth' ? t('Bluetooth audio')
          : route.routeKind === 'external' ? t('Audio output') : t('Devices')
  );
  const color = remoteName ? activeTint ?? tint : tint;
  return (
    <GlassPressable
      style={style}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`${t('Devices')}: ${label}`}
      onPress={onPress}
    >
      <View style={{ alignItems: 'center', minHeight: 44, maxWidth: 150, justifyContent: 'center', gap: 3 }}>
        <Icon name={remoteName ? 'laptop-outline' : routeIcon(route.routeKind)} size={26} color={color} />
        <Text numberOfLines={1} style={{ color, fontSize: 10, fontWeight: '600', textAlign: 'center' }}>
          {label}
        </Text>
      </View>
    </GlassPressable>
  );
}
