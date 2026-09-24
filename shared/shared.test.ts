import { describe, expect, it } from 'vitest';
import { normalizePhone, isValidPhone, internationalPhone } from './phone.js';
import { parseLooseNumber, formatMoneyShort, verificationFreshness } from './format.js';

describe('phone normalisation', () => {
  it('treats common Egyptian formats as the same number', () => {
    const variants = ['01012345678', '+20 101 234 5678', '0020-101-234-5678', '1012345678', '(010) 1234 5678', '201012345678'];
    for (const v of variants) expect(normalizePhone(v)).toBe('01012345678');
  });
  it('validates length', () => {
    expect(isValidPhone('01012345678')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
  });
  it('builds international numbers for WhatsApp', () => {
    expect(internationalPhone('010 1234 5678')).toBe('201012345678');
  });
});

describe('number parsing', () => {
  it('understands spreadsheet-style values', () => {
    expect(parseLooseNumber('42,000,000')).toBe(42_000_000);
    expect(parseLooseNumber('42M')).toBe(42_000_000);
    expect(parseLooseNumber('3.5m')).toBe(3_500_000);
    expect(parseLooseNumber('750k')).toBe(750_000);
    expect(parseLooseNumber('EGP 1,200,000')).toBe(1_200_000);
    expect(parseLooseNumber('350 sqm')).toBe(350);
    expect(parseLooseNumber('')).toBeUndefined();
    expect(parseLooseNumber('call me')).toBeNaN();
  });
  it('formats short money', () => {
    expect(formatMoneyShort(42_000_000)).toBe('42M');
    expect(formatMoneyShort(3_250_000)).toBe('3.25M');
  });
});

describe('verification freshness', () => {
  const t = { attention: 15, outdated: 30 };
  const now = new Date('2026-09-30T12:00:00');
  it('classifies by age', () => {
    expect(verificationFreshness('2026-09-25', t, now)).toBe('current');
    expect(verificationFreshness('2026-09-10', t, now)).toBe('attention');
    expect(verificationFreshness('2026-08-01', t, now)).toBe('outdated');
    expect(verificationFreshness(null, t, now)).toBe('never');
  });
});
