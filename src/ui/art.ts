import {BUILDINGS, TECHS, UNITS} from '../game/data';

/** Row-major coordinates in the original, bundled 6 × 6 inventory illustration. */
export const ART_KEYS = [
  'food', 'wood', 'gold', 'stone', 'villager', 'scout',
  'infantry', 'spearman', 'archer', 'cavalry', 'heavy', 'siege',
  'towncenter', 'house', 'granary', 'storage', 'farm', 'market',
  'barracks', 'range', 'stable', 'workshop', 'tower', 'wall',
  'gate', 'academy', 'gather', 'carry', 'tech-infantry', 'tech-ranged',
  'tech-armor', 'tech-health', 'tech-durability', 'tech-tower', 'rally', 'age',
] as const;

export type ArtKey = typeof ART_KEYS[number];
export const ATLAS_URL = `${import.meta.env.BASE_URL}assets/inventory-atlas.png`;
const indexes = new Map<string, number>(ART_KEYS.map((key, index) => [key, index]));

const aliases: Record<string, ArtKey> = {age2: 'age', age3: 'age', age4: 'age', 'tech-gather': 'gather', 'tech-carry': 'carry'};
const resourceLabels: Record<string, string> = {food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone', rally: 'Rally point', age: 'Age advancement'};

function escape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
}

function label(key: ArtKey): string {
  if (resourceLabels[key]) return resourceLabels[key]!;
  if (key in UNITS) return UNITS[key as keyof typeof UNITS].name;
  if (key in BUILDINGS) return BUILDINGS[key as keyof typeof BUILDINGS].name;
  const tech = key.startsWith('tech-') ? key.slice(5) : key;
  return tech in TECHS ? TECHS[tech as keyof typeof TECHS].name : 'Kingdom illustration';
}

/** Set --art-size on a class or ancestor to size these square, accessible sprites. */
export function art(key: string, className = ''): string {
  const resolved = aliases[key] ?? key;
  const index = indexes.get(resolved) ?? indexes.get('age')!;
  const known = ART_KEYS[index]!;
  const name = label(known);
  const x = index % 6 * 20, y = Math.floor(index / 6) * 20;
  const style = `display:inline-block;flex:none;vertical-align:middle;width:var(--art-size,48px);height:var(--art-size,48px);background-image:url('${ATLAS_URL}');background-size:600% 600%;background-position:${x}% ${y}%;background-repeat:no-repeat`;
  return `<span class="${escape(`atlas-art ${className}`.trim())}" role="img" aria-label="${escape(name)}" title="${escape(name)}" data-art="${known}" style="${escape(style)}"></span>`;
}
