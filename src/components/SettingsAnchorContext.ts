import { createContext } from 'react';
import type { ScrollView, View } from 'react-native';

export interface SettingsAnchorScroll {
  target: string;
  visit: string;
  translatedTarget: string;
  registerScroll: (scroll: ScrollView | null, content: View | null) => void;
  registerTarget: (view: View | null) => void;
  locate: () => void;
}
export const SettingsAnchorContext = createContext<SettingsAnchorScroll | undefined>(undefined);
