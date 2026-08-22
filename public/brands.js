// Local brand marks for observed agents/providers. Files are packaged copies of
// installed official app icons. Models without a distinct official mark use the
// provider/agent mark plus the model name. No hotlinking.

export const BRANDS = Object.freeze({
  Claude: { id: 'Claude', kind: 'agent', file: 'claude.png', color: '#E69B7C', letter: 'C' },
  Anthropic: { id: 'Anthropic', kind: 'provider', file: 'claude.png', color: '#E69B7C', letter: 'A' },
  Codex: { id: 'Codex', kind: 'agent', file: 'codex.png', color: '#D7D0C5', letter: 'X' },
  OpenAI: { id: 'OpenAI', kind: 'provider', file: 'codex.png', color: '#D7D0C5', letter: 'O' },
  Cursor: { id: 'Cursor', kind: 'agent', file: 'cursor.png', color: '#2EE6C3', letter: 'I' },
  Kimi: { id: 'Kimi', kind: 'agent', file: null, color: '#7EB6FF', letter: 'K' },
  Moonshot: { id: 'Moonshot', kind: 'provider', file: null, color: '#7EB6FF', letter: 'M' },
  DeepSeek: { id: 'DeepSeek', kind: 'agent', file: null, color: '#4C6FFF', letter: 'D' },
  Grok: { id: 'Grok', kind: 'agent', file: null, color: '#E8E8E8', letter: 'G' },
  xAI: { id: 'xAI', kind: 'provider', file: null, color: '#E8E8E8', letter: 'X' },
  Gemini: { id: 'Gemini', kind: 'agent', file: null, color: '#8AB4F8', letter: 'G' },
  Google: { id: 'Google', kind: 'provider', file: null, color: '#8AB4F8', letter: 'G' },
  Copilot: { id: 'Copilot', kind: 'agent', file: null, color: '#9B8CFF', letter: 'C' },
  'GitHub Copilot': { id: 'GitHub Copilot', kind: 'agent', file: null, color: '#9B8CFF', letter: 'C' },
  OpenCode: { id: 'OpenCode', kind: 'agent', file: null, color: '#F2C14E', letter: 'O' },
  Antigravity: { id: 'Antigravity', kind: 'host', file: null, color: '#8AB4F8', letter: 'A' },
  Windsurf: { id: 'Windsurf', kind: 'host', file: null, color: '#6EE7B7', letter: 'W' }
});

export function brandOf(name) {
  const label = String(name || '').trim();
  if (!label) return { id: 'Unknown', kind: 'unknown', file: null, color: '#FF2D78', letter: '?', label: 'Unknown', fallback: true };
  if (BRANDS[label]) return { ...BRANDS[label], label, fallback: !BRANDS[label].file };
  const found = Object.values(BRANDS).find((brand) => brand.id.toLowerCase() === label.toLowerCase());
  if (found) return { ...found, label, fallback: !found.file };
  return { id: label, kind: 'unknown', file: null, color: '#FF2D78', letter: label.slice(0, 1).toUpperCase(), label, fallback: true };
}

export function brandColor(name, index = 0) {
  const brand = brandOf(name);
  if (!brand.fallback) return brand.color;
  const palette = ['#FF2D78', '#E69B7C', '#79B8AA', '#7EB6FF', '#F2C14E', '#9B8CFF'];
  return palette[Math.abs(index) % palette.length];
}

export function brandPhase(name) {
  const text = String(name || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 628) / 100;
}
