// Helpers that turn developer / CRM spreadsheet exports into clean records.

import { normalizePhone } from '../../shared/phone.js';

export interface ParsedLocation {
  project: string | null;
  phase: string | null;
  unit_number: string;
  property_type: string | null;
}

const TYPE_CODES: [RegExp, string][] = [
  [/(^|[-\s])V-V[-\s]/, 'Villa'],
  [/(^|[-\s])TH-TH([-\s]|\d)/, 'Townhouse'],
  [/(^|[-\s])TW-TW[-\s]/, 'Twin House'],
  [/(^|[-\s])SA-/, 'Apartment'],
];

/** Guesses the unit type from Emaar-style unit codes; null when unsure. */
export function inferPropertyType(unit: string): string | null {
  const u = ` ${unit}`;
  for (const [re, type] of TYPE_CODES) if (re.test(u)) return type;
  // building-floor-unit, e.g. "8G-2-2", "D5-G-1", "21EM-3-1": coastal apartments are sold as chalets
  if (/^[A-Z]*\d+[A-Z]*-(G|\d{1,2})-\d+$/i.test(unit)) return 'Chalet';
  return null;
}

const NAME_PART = /^[A-Z][a-z]{2,}$/; // "Residences", "West", "Lagoons", "Beach"
const PHASE_PART = /^P\d{1,2}[A-Z]?$/; // "P1", "P1B"

/**
 * Splits a location code into project, phase (neighbourhood) and unit number.
 *   "Marassi Arezzo P1 V-V-153"          → Marassi | Arezzo P1 | V-V-153
 *   "Marassi Marina Residences-21EM-3-1" → Marassi | Marina Residences | 21EM-3-1
 *   "Marassi Verona P1 TH-TH 3-378"      → Marassi | Verona P1 | TH-TH 3-378
 *   "Marassi Lea-5B-2-3"                 → Marassi | Lea | 5B-2-3
 * `projects` are known project names used to recognise the prefix.
 */
export function parseLocationCode(code: string, projects: string[], hintProject?: string | null): ParsedLocation | null {
  let rest = code.replace(/\s+/g, ' ').trim();
  if (!rest) return null;
  let project: string | null = null;
  const candidates = [hintProject, ...[...projects].sort((a, b) => b.length - a.length)].filter(Boolean) as string[];
  for (const p of candidates) {
    if (rest.toLowerCase().startsWith(p.toLowerCase() + ' ') || rest.toLowerCase().startsWith(p.toLowerCase() + '-')) {
      project = p;
      rest = rest.slice(p.length + 1).trim();
      break;
    }
  }
  const words = rest.split(' ');
  // The unit starts at the first word containing a hyphen (or a bare type code like "TH-TH").
  let i = words.findIndex((w) => w.includes('-'));
  if (i === -1) i = words.length - 1;
  const zone = words.slice(0, i);
  const parts = words[i].split('-');
  while (parts.length > 1 && (NAME_PART.test(parts[0]) || (zone.length > 0 && PHASE_PART.test(parts[0]) && parts.length > 2))) {
    zone.push(parts.shift()!);
  }
  // "Marina 2-8G-2-2": a small number directly after the neighbourhood, followed by a
  // building-floor-unit code, is part of the neighbourhood name ("Marina 2").
  if (zone.length > 0 && parts.length >= 4 && /^\d{1,2}$/.test(parts[0]) && /\d/.test(parts[1]) && /[A-Z]/i.test(parts[1])) {
    zone.push(parts.shift()!);
  }
  const unit = [parts.join('-'), ...words.slice(i + 1)].join(' ').trim();
  if (!unit) return null;
  return { project, phase: zone.join(' ') || null, unit_number: unit, property_type: inferPropertyType(unit) };
}

function digits(s: string) {
  return s.replace(/\D/g, '');
}

/**
 * Combines an optional country-code column ("Egypt: 0020", "United Arab Emirates: 00971", "20")
 * with a number column. Returns the display number (local format for Egypt, +CC… otherwise)
 * plus any extra number found in the same cell ("0100… - 0122…").
 */
export function combinePhone(countryCode: string | null | undefined, number: string | null | undefined): { phone: string | null; extra: string | null } {
  const raw = String(number ?? '').replace(/[‎‏‪-‮]/g, '').trim();
  // Two numbers in one cell ("0106…-0127…", "506… / 504…"): split only when both halves are full numbers.
  const parts = raw.split(/\s*[-/;,]+\s*/);
  const [first, second] = parts.length >= 2 && parts.every((p) => digits(p).length >= 7) ? parts : [raw];
  const one = (input: string | undefined): string | null => {
    if (!input) return null;
    // "Egypt: 0020 1145569233" → "0020 1145569233"; a bare label ("Egypt: 0020") leaves too few digits
    const n = input.replace(/^[A-Za-z][A-Za-z .]*:\s*/, '');
    if (/[a-z]/i.test(n) || digits(n).length < 6) return null;
    const cc = digits(String(countryCode ?? '')).replace(/^00/, '');
    const trimmed = n.replace(/[\s().-]/g, '');
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      const intl = trimmed.replace(/^\+|^00/, '');
      return intl.startsWith('20') ? normalizePhone(intl) : `+${intl}`;
    }
    if (!cc || cc === '20') return normalizePhone(trimmed);
    if (trimmed.startsWith(cc) && trimmed.length > cc.length + 6) return `+${trimmed}`;
    return `+${cc}${trimmed.replace(/^0+/, '')}`;
  };
  return { phone: one(first), extra: one(second) };
}

/** Cleans an English person/company name: drops "NULL" placeholders and capitalises all-lowercase words. */
export function cleanPersonName(v: string | null | undefined): string | null {
  const words = String(v ?? '')
    .split(/\s+/)
    .filter((w) => w && !/^(null|n\/a|na|none|-)$/i.test(w));
  const s = words.map((w) => (/^[a-z][a-z'-]*$/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  return s || null;
}

/** True when a phone cell holds only a country label or placeholder, e.g. "Egypt: 0020". */
export function isPhonePlaceholder(v: string): boolean {
  return /[a-z]/i.test(v) && digits(v).length <= 5;
}

/** " / عصام  عبد العزيز" → "عصام عبد العزيز"; empty when nothing Arabic remains. */
export function cleanArabicName(v: string | null | undefined): string | null {
  const s = String(v ?? '').replace(/^[\s/]+|[\s/]+$/g, '').replace(/\s+/g, ' ').trim();
  return /[؀-ۿ]/.test(s) ? s : null;
}

/** "175 ش طيبة, ,<br>Alex  Egypt" → "175 ش طيبة, Alex Egypt" */
export function cleanAddress(v: string | null | undefined): string | null {
  const s = String(v ?? '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/\s+/g, ' ')
    .replace(/(\s*,\s*)+/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
  return s || null;
}
