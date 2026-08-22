// Appearance is deliberately limited to a validated accent. The rest of the
// Design Delulu system, including semantic state colors, remains fixed.
export const DEFAULT_ACCENT = '#FF2D78';
export const ACCENT_STORAGE_KEY = 'ai-dashboard-accent';

export const ACCENT_PRESETS = Object.freeze([
  { name: 'Hot Pink', value: DEFAULT_ACCENT },
  { name: 'Red', value: '#EF4444' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Lime', value: '#84CC16' },
  { name: 'Green', value: '#22C55E' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Violet', value: '#8B5CF6' },
  { name: 'Purple', value: '#A855F7' }
]);

export function normalizeAccentColor(value) {
  const text = String(value || '').trim();
  const short = text.match(/^#?([0-9a-f]{3})$/i);
  const long = text.match(/^#?([0-9a-f]{6})$/i);
  const hex = short ? short[1].split('').map((part) => part + part).join('') : long?.[1];
  return hex ? `#${hex.toUpperCase()}` : null;
}

function rgb(hex) { return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)); }
function mix(hex, other, amount) {
  const [r, g, b] = rgb(hex), [or, og, ob] = rgb(other);
  return `#${[r, g, b].map((value, index) => Math.round(value + ([or, og, ob][index] - value) * amount).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
function luminance(hex) {
  return rgb(hex).map((value) => { const channel = value / 255; return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; })
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) { const [light, dark] = [luminance(a), luminance(b)].sort((first, second) => second - first); return (light + .05) / (dark + .05); }

export function accentTheme(value) {
  const accent = normalizeAccentColor(value) || DEFAULT_ACCENT;
  const [red, green, blue] = rgb(accent);
  return { accent, accentRgb: `${red}, ${green}, ${blue}`, accentHover: mix(accent, '#FFFFFF', .16), accentMuted: mix(accent, '#FFFFFF', .38), accentForeground: contrast(accent, '#141413') >= contrast(accent, '#FFFFFF') ? '#141413' : '#FFFFFF' };
}

export function applyAccent(value, root = globalThis.document?.documentElement) {
  const theme = accentTheme(value);
  if (!root) return theme;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-rgb', theme.accentRgb);
  root.style.setProperty('--accent-soft', `rgba(${theme.accentRgb}, .13)`);
  root.style.setProperty('--accent-border', `rgba(${theme.accentRgb}, .42)`);
  root.style.setProperty('--accent-glow', `rgba(${theme.accentRgb}, .05)`);
  root.style.setProperty('--accent-hover', theme.accentHover);
  root.style.setProperty('--accent-muted', theme.accentMuted);
  root.style.setProperty('--accent-foreground', theme.accentForeground);
  return theme;
}

export function storedAccent(storage = globalThis.localStorage) { try { return normalizeAccentColor(storage?.getItem(ACCENT_STORAGE_KEY)) || DEFAULT_ACCENT; } catch { return DEFAULT_ACCENT; } }
export function rememberAccent(value, storage = globalThis.localStorage) { const accent = normalizeAccentColor(value); if (!accent) return null; try { storage?.setItem(ACCENT_STORAGE_KEY, accent); } catch {} return accent; }
export function initializeAccent() { return applyAccent(storedAccent()); }
