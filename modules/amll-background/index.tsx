import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { Platform, View, type ViewProps } from 'react-native';

export type AmllBackgroundViewProps = ViewProps & {
  localUri?: string | null;
  active: boolean;
};

const installed = Platform.OS === 'android' &&
  requireOptionalNativeModule('ResonusAmllBackground') != null;

export const AmllBackgroundView = installed
  ? requireNativeView<AmllBackgroundViewProps>('ResonusAmllBackground')
  : function AmllBackgroundFallback({ localUri: _localUri, active: _active, ...props }: AmllBackgroundViewProps) {
    return <View {...props} />;
  };
