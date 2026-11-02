import { createContext } from 'react';

/** Only main scrolls inside a settings frame reserve this dynamic dock space;
 * dialogs and other screens retain their own layout and scrolling behavior. */
export const SettingsScrollPaddingContext = createContext<number | undefined>(undefined);
