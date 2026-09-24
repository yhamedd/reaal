export function formatMoney(value: number | null | undefined, currency = 'EGP'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return `${Math.round(value).toLocaleString('en-US')} ${currency}`.trim();
}

/** Compact form used in tables and activity: 42000000 → "42M". */
export function formatMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  const abs = Math.abs(value);
  const trim = (n: number) => (Math.round(n * 100) / 100).toString();
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return value.toLocaleString('en-US');
}

/**
 * Parses loosely formatted numbers from spreadsheets and inline edits:
 * "42,000,000", "42M", "3.5m", "750k", "EGP 1,200,000", "350 sqm".
 * Returns undefined for empty input and NaN for unparseable text.
 */
export function parseLooseNumber(input: unknown): number | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  const raw = String(input).trim();
  if (!raw) return undefined;
  const s = raw.toLowerCase().replace(/egp|le|l\.e\.|sqm|m2|m²|sq\.?\s*m|,|\s/g, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)(k|m|mn|mil|million|b|bn)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const suffix = m[2];
  if (!suffix) return n;
  if (suffix === 'k') return n * 1_000;
  if (suffix === 'b' || suffix === 'bn') return n * 1_000_000_000;
  return n * 1_000_000;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function daysSince(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

export type Freshness = 'current' | 'attention' | 'outdated' | 'never';

export function verificationFreshness(
  lastVerified: string | null | undefined,
  thresholds: { attention: number; outdated: number },
  now = new Date(),
): Freshness {
  const days = daysSince(lastVerified, now);
  if (days === null) return 'never';
  if (days >= thresholds.outdated) return 'outdated';
  if (days >= thresholds.attention) return 'attention';
  return 'current';
}
