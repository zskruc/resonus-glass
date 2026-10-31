/** Catches render errors so one of them cannot take the whole app down. */
import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { tg } from '@/i18n';
import { colors, fontSize, radius, spacing, themed, tracking } from '@/theme';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{tg('Something went wrong')}</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          {/* Acento inline: el módulo se importa antes de hidratar los ajustes
              y la hoja congelaría el verde por defecto. */}
          <Pressable style={[styles.button, { backgroundColor: colors.accent }]} onPress={this.reset}>
            <Text style={styles.buttonText}>{tg('Try again')}</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = themed((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  message: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  button: {
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.onAccent, fontSize: fontSize.md, fontWeight: '600' },
}));
