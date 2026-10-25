import { DockScrollView } from '@/components/DockScrollView';
import { ColorPickerDialog } from '@/components/ColorPickerDialog';
import { GlassTuningPreview } from '@/components/GlassTuningPreview';
import Icon from '@/components/Icon';
import { SettingsPage } from '@/components/SettingsUI';
import { useT, type TFunction } from '@/i18n';
import {
  exportGlassTuning, getGlassDefaults, resolveGlassProfile, useGlassTuning,
  type GlassAppearanceMode, type GlassProfile, type GlassTarget,
} from '@/store/glassTuning';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { SCREEN_BOTTOM_PADDING, themed, useTheme, useThemeMode } from '@/theme';
import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { Pressable, Share, Switch, Text, View } from 'react-native';
import { isLiquidGlassAvailable } from '../../../modules/liquid-glass';

const TARGETS: { value: GlassTarget; label: string }[] = [
  { value: 'miniPlayer', label: 'Mini player' },
  { value: 'navigation', label: 'Navigation bar' },
  { value: 'controls', label: 'Other surfaces' },
];
const MODES: { value: GlassAppearanceMode; label: string }[] = [
  { value: 'iphoneReference', label: 'iPhone reference' },
  { value: 'custom', label: 'Custom parameters' },
];

type NumericParameter = 'blur' | 'refraction' | 'refractionHeight' | 'highlightWidth' | 'highlightOpacity' | 'tintOpacity';
const PARAMETERS: { key: NumericParameter; label: string; description: string; max: number; step: number; percent?: boolean }[] = [
  { key: 'blur', label: 'Background blur', description: 'Lower values keep the background clear.', max: 24, step: 0.5 },
  { key: 'refraction', label: 'Refraction strength', description: 'Higher values bend the background more.', max: 48, step: 1 },
  { key: 'refractionHeight', label: 'Lens edge depth', description: 'Controls how far the lens effect extends from the edge.', max: 48, step: 1 },
  { key: 'highlightWidth', label: 'Highlight width', description: 'Thickness of the light along the glass edge.', max: 3, step: 0.1 },
  { key: 'highlightOpacity', label: 'Highlight intensity', description: 'Brightness of the reflected edge light.', max: 1, step: 0.01, percent: true },
  { key: 'tintOpacity', label: 'Tint opacity', description: 'Lower values show more of the background.', max: 1, step: 0.01, percent: true },
];

const TINTS = [
  { color: null, label: 'Automatic tint' },
  { color: '#FFFFFF', label: 'White' },
  { color: '#000000', label: 'Black' },
  { color: '#77B6FF', label: 'Blue' },
  { color: '#DFA7FF', label: 'Purple' },
  { color: '#F7B6C9', label: 'Pink' },
];

function contrastingInk(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const brightness = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return brightness > 140 ? '#121620' : '#FFFFFF';
}

function ParameterSlider({ parameter, value, onChange, disabled, t }: {
  parameter: (typeof PARAMETERS)[number]; value: number; onChange: (value: number) => void; disabled: boolean; t: TFunction;
}) {
  const colors = useTheme();
  const display = parameter.percent ? `${Math.round(value * 100)}%` : `${Number(value.toFixed(2))} dp`;
  return (
    <View style={styles.parameter}>
      <View style={styles.parameterHeader}>
        <Text style={styles.parameterLabel}>{t(parameter.label)}</Text>
        <Text style={styles.parameterValue}>{display}</Text>
      </View>
      <Text style={styles.description}>{t(parameter.description)}</Text>
      <Slider
        style={styles.slider}
        value={value}
        minimumValue={0}
        maximumValue={parameter.max}
        step={parameter.step}
        disabled={disabled}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.textMuted}
        thumbTintColor={colors.accent}
        accessibilityLabel={`${t(parameter.label)}, ${display}`}
        onValueChange={(next) => onChange(Number(next.toFixed(2)))}
      />
      <View style={styles.rangeRow}>
        <Text style={styles.rangeLabel}>0</Text>
        <Text style={styles.rangeLabel}>{parameter.percent ? '100%' : parameter.max}</Text>
      </View>
    </View>
  );
}

export default function GlassTuningSettings() {
  const t = useT();
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const [target, setTarget] = useState<GlassTarget>('miniPlayer');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const overrides = useGlassTuning((state) => state.overrides);
  const mode = useGlassTuning((state) => state.mode);
  const setMode = useGlassTuning((state) => state.setMode);
  const hydrated = useGlassTuning((state) => state.hydrated);
  const update = useGlassTuning((state) => state.update);
  const save = useGlassTuning((state) => state.save);
  const reset = useGlassTuning((state) => state.reset);
  const blurMiniPlayer = useSettings((state) => state.blurMiniPlayer);
  const blurBars = useSettings((state) => state.blurBars);
  const setBlurMiniPlayer = useSettings((state) => state.setBlurMiniPlayer);
  const setBlurBars = useSettings((state) => state.setBlurBars);
  const showToast = useToast((state) => state.show);
  const profile = resolveGlassProfile(target, dark, overrides[target], mode);
  const parameters = target === 'miniPlayer' ? PARAMETERS.filter((parameter) => parameter.key !== 'tintOpacity') : PARAMETERS;
  const editingDisabled = !hydrated || mode === 'iphoneReference';
  const enabled = target === 'miniPlayer' ? blurMiniPlayer : target === 'navigation' ? blurBars : true;

  async function saveParameters() {
    setSaving(true);
    try {
      await save();
      showToast(t('Glass parameters saved'));
    } catch {
      showToast(t('Could not save glass parameters.'));
    } finally {
      setSaving(false);
    }
  }

  async function exportParameters() {
    try {
      await Share.share({ title: t('Glass parameters'), message: exportGlassTuning() });
    } catch {
      showToast(t('Could not export glass parameters.'));
    }
  }

  function resetParameters() {
    reset(target);
    showToast(t('Defaults restored. Save to keep them.'));
  }

  function preset(kind: 'clear' | 'strong' | 'soft') {
    const defaults = getGlassDefaults(target, dark);
    const profiles: Record<typeof kind, GlassProfile> = {
      clear: { ...defaults, blur: 1.5, refraction: 14, refractionHeight: 14, highlightWidth: 0.8, highlightOpacity: 0.7, tintOpacity: 0.1, tintColor: null, depthEffect: true, chromaticAberration: false },
      strong: { ...defaults, blur: 2, refraction: 32, refractionHeight: 28, highlightWidth: 1.2, highlightOpacity: 0.8, tintOpacity: 0.12, tintColor: null, depthEffect: true, chromaticAberration: true },
      soft: { ...defaults, blur: 12, refraction: 12, refractionHeight: 12, highlightWidth: 0.5, highlightOpacity: 0.45, tintOpacity: 0.3, tintColor: null, depthEffect: true, chromaticAberration: false },
    };
    update(target, profiles[kind]);
  }

  return (
    <SettingsPage title={t('Glass tuning')}>
      <View style={[styles.targets, styles.modes]}>
        {MODES.map((item) => (
          <Pressable key={item.value} disabled={!hydrated}
            onPress={() => { setMode(item.value); setPickerOpen(false); }}
            accessibilityRole="button" accessibilityState={{ selected: mode === item.value }}
            style={[styles.targetButton, mode === item.value && styles.targetActive, !hydrated && styles.disabled]}>
            <Text style={[styles.targetLabel, mode === item.value && { color: colors.accent }]}>{t(item.label)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.targets}>
        {TARGETS.map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setTarget(item.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: target === item.value }}
            style={[styles.targetButton, target === item.value && styles.targetActive]}
          >
            <Text style={[styles.targetLabel, target === item.value && { color: colors.accent }]}>{t(item.label)}</Text>
          </Pressable>
        ))}
      </View>
      <GlassTuningPreview target={target} />
      <View style={styles.actions}>
        <Pressable
          onPress={saveParameters}
          disabled={!hydrated || saving}
          accessibilityRole="button"
          style={[styles.actionButton, styles.primaryAction, (!hydrated || saving) && styles.disabled]}
        >
          <Icon name="checkmark" size={18} color={dark ? '#080B12' : '#FFFFFF'} />
          <Text style={[styles.primaryActionLabel, { color: dark ? '#080B12' : '#FFFFFF' }]}>{t(saving ? 'Saving…' : 'Save parameters')}</Text>
        </Pressable>
        <Pressable onPress={exportParameters} disabled={!hydrated} accessibilityRole="button" style={[styles.actionButton, styles.secondaryAction]}>
          <Icon name="share-outline" size={18} color={colors.text} />
          <Text style={styles.actionLabel}>{t('Export parameters')}</Text>
        </Pressable>
      </View>
      <DockScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.introduction}>{t('Changes apply live. Save to keep them after restarting. Export your finished settings and send them to me.')}</Text>
        {mode === 'iphoneReference' ? <Text style={styles.notice}>{t('iPhone reference approximates the observed appearance; it does not copy Apple’s private parameters. Switch to Custom parameters to restore and edit your saved styles.')}</Text> : null}
        {!isLiquidGlassAvailable ? <Text style={styles.notice}>{t('Native liquid glass is unavailable on this device. This preview uses a solid fallback.')}</Text> : null}
        {!enabled ? (
          <View style={styles.noticeBox}>
            <Text style={styles.notice}>{t('Enable glass for this control to see your changes.')}</Text>
            <Pressable
              onPress={() => target === 'miniPlayer' ? setBlurMiniPlayer(true) : setBlurBars(true)}
              accessibilityRole="button"
              style={styles.smallButton}
            ><Text style={styles.linkLabel}>{t('Enable glass')}</Text></Pressable>
          </View>
        ) : null}
        {target === 'controls' ? <Text style={styles.description}>{t('These parameters apply to panels, dialogs, and fields. Buttons use their original styles.')}</Text> : null}
        <Text style={styles.sectionTitle}>{t('Starting styles')}</Text>
        <View style={styles.presets}>
          {([{ kind: 'clear', label: 'Clear glass' }, { kind: 'strong', label: 'Strong lens' }, { kind: 'soft', label: 'Soft glass' }] as const).map((item) => (
            <Pressable key={item.kind} onPress={() => preset(item.kind)} disabled={editingDisabled} accessibilityRole="button" style={[styles.presetButton, editingDisabled && styles.disabled]}>
              <Text style={styles.actionLabel}>{t(item.label)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionTitle}>{t('Lens and light')}</Text>
        <View style={styles.card}>
          {parameters.map((parameter) => (
            <ParameterSlider key={parameter.key} parameter={parameter} value={profile[parameter.key]} disabled={editingDisabled} t={t} onChange={(value) => update(target, { [parameter.key]: value })} />
          ))}
        </View>
        {target !== 'miniPlayer' ? (
          <>
            <Text style={styles.sectionTitle}>{t('Glass tint')}</Text>
            <Text style={styles.description}>{t('Choose a color; tint opacity controls how much it covers the background.')}</Text>
            <View style={styles.swatches}>
              {TINTS.map((swatch) => {
                const selected = profile.tintColor?.toUpperCase() === swatch.color || (!profile.tintColor && swatch.color === null);
                return (
                  <Pressable
                    key={swatch.label}
                    onPress={() => update(target, { tintColor: swatch.color })}
                    disabled={editingDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={t(swatch.label)}
                    accessibilityState={{ selected }}
                    style={[styles.swatch, { backgroundColor: swatch.color ?? colors.surfaceHighlight }, selected && styles.swatchSelected, editingDisabled && styles.disabled]}
                  >
                    {swatch.color === null ? <Text style={[styles.autoLabel, { color: colors.text }]}>{t('Auto::glass')}</Text> : null}
                    {selected ? <Icon name="checkmark" size={22} color={swatch.color === '#000000' ? '#FFFFFF' : swatch.color ? '#121620' : colors.text} /> : null}
                  </Pressable>
                );
              })}
              <Pressable disabled={editingDisabled} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel={t('Custom color')} style={[styles.swatch, styles.customSwatch, profile.tintColor && !TINTS.some((tint) => tint.color === profile.tintColor?.toUpperCase()) ? { backgroundColor: profile.tintColor } : null, editingDisabled && styles.disabled]}>
                <Icon name="color-palette-outline" size={22} color={profile.tintColor && !TINTS.some((tint) => tint.color === profile.tintColor?.toUpperCase()) ? contrastingInk(profile.tintColor) : colors.text} />
              </Pressable>
            </View>
            <Text style={styles.tintValue}>{profile.tintColor ?? t('Automatic tint follows each control’s original color.')}</Text>
          </>
        ) : null}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}><Text style={styles.parameterLabel}>{t('Depth effect')}</Text><Text style={styles.description}>{t('Adds a rounded three-dimensional lens shape.')}</Text></View>
            <Switch value={profile.depthEffect} disabled={editingDisabled} onValueChange={(value) => update(target, { depthEffect: value })} trackColor={{ true: colors.accent }} accessibilityLabel={t('Depth effect')} />
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}><Text style={styles.parameterLabel}>{t('Color dispersion')}</Text><Text style={styles.description}>{t('Adds subtle colored edges to refracted details.')}</Text></View>
            <Switch value={profile.chromaticAberration} disabled={editingDisabled} onValueChange={(value) => update(target, { chromaticAberration: value })} trackColor={{ true: colors.accent }} accessibilityLabel={t('Color dispersion')} />
          </View>
        </View>
        <View style={styles.management}>
          <Pressable
            onPress={() => {
              TARGETS.forEach((item) => update(item.value, { ...profile }));
              showToast(t('Applied to all glass controls'));
            }}
            disabled={editingDisabled}
            accessibilityRole="button"
            style={[styles.smallButton, editingDisabled && styles.disabled]}
          ><Text style={styles.linkLabel}>{t('Apply to all controls')}</Text></Pressable>
          <Pressable onPress={resetParameters} disabled={editingDisabled || saving} accessibilityRole="button" style={[styles.smallButton, (editingDisabled || saving) && styles.disabled]}><Text style={styles.linkLabel}>{t('Reset this control')}</Text></Pressable>
        </View>
        <Text style={styles.sectionTitle}>{t('Current parameters')}</Text>
        <Text style={styles.description}>{t('You can copy or screenshot these values. Export includes all three control styles.')}</Text>
        {mode === 'iphoneReference' ? <Text style={styles.description}>{t('Export keeps your three custom styles; the reference style does not overwrite them.')}</Text> : null}
        <Text selectable style={styles.summary}>{[
          `${t(MODES.find((item) => item.value === mode)!.label)} · ${t(TARGETS.find((item) => item.value === target)!.label)}`,
          ...parameters.map((parameter) => `${t(parameter.label)}: ${parameter.percent
            ? `${Math.round(profile[parameter.key] * 100)}%`
            : `${Number(profile[parameter.key].toFixed(2))} dp`}`),
          `${t('Glass tint')}: ${target === 'miniPlayer' ? t('Off') : profile.tintColor ?? t('Automatic tint')}`,
          `${t('Depth effect')}: ${t(profile.depthEffect ? 'On' : 'Off')}`,
          `${t('Color dispersion')}: ${t(profile.chromaticAberration ? 'On' : 'Off')}`,
        ].join('\n')}</Text>
      </DockScrollView>
      {target !== 'miniPlayer' && pickerOpen && !editingDisabled ? <ColorPickerDialog initialColor={profile.tintColor ?? (dark ? '#FFFFFF' : '#000000')} onCancel={() => setPickerOpen(false)} onSave={(color) => { update(target, { tintColor: color }); setPickerOpen(false); }} /> : null}
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  targets: { flexDirection: 'row', marginHorizontal: 20, padding: 3, borderRadius: 18, backgroundColor: colors.surface, gap: 4 },
  modes: { marginBottom: 8 },
  targetButton: { flex: 1, minHeight: 36, borderRadius: 15, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  targetActive: { backgroundColor: colors.surfaceHighlight },
  targetLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  actions: { flexDirection: 'row', marginHorizontal: 20, gap: 10, paddingTop: 5, paddingBottom: 8 },
  actionButton: { flex: 1, minHeight: 42, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  primaryAction: { backgroundColor: colors.accent },
  primaryActionLabel: { fontSize: 13, fontWeight: '600' },
  secondaryAction: { backgroundColor: colors.surfaceHighlight },
  actionLabel: { fontSize: 13, fontWeight: '500', color: colors.text },
  disabled: { opacity: 0.5 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: SCREEN_BOTTOM_PADDING, paddingTop: 4 },
  introduction: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  noticeBox: { padding: 12, backgroundColor: colors.surface, borderRadius: 12, marginBottom: 12 },
  notice: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 14, marginBottom: 10 },
  presets: { flexDirection: 'row', gap: 8 },
  presetButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 4 },
  card: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' },
  parameter: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, borderBottomColor: colors.surfaceHighlight, borderBottomWidth: 1 },
  parameterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  parameterLabel: { color: colors.text, fontSize: 14, fontWeight: '500' },
  parameterValue: { color: colors.accent, fontSize: 13, fontVariant: ['tabular-nums'] },
  description: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  slider: { height: 38, marginHorizontal: -4 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  rangeLabel: { fontSize: 10, color: colors.textMuted },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  swatch: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.textMuted },
  swatchSelected: { borderWidth: 3, borderColor: colors.accent },
  autoLabel: { fontSize: 10 },
  customSwatch: { backgroundColor: colors.surfaceHighlight },
  tintValue: { color: colors.textMuted, fontSize: 12, marginVertical: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  toggleText: { flex: 1, gap: 4 },
  management: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  smallButton: { paddingVertical: 10, paddingHorizontal: 3 },
  linkLabel: { color: colors.accent, fontSize: 13, fontWeight: '500' },
  summary: { color: colors.text, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'], backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginTop: 10 },
}));
