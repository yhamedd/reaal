import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, renderBlock, renderOffer, sensitiveTokens } from './offerText.js';

const villa = {
  id: 12,
  project: 'Mivida',
  property_type: 'Standalone Villa',
  bua: 350,
  land_area: 500,
  bedrooms: 4,
  finishing: 'Fully Finished',
  asking_price: 42_000_000,
  owner_name: 'Ahmed Mohamed',
  owner_phone: '01012345678',
};

describe('template engine', () => {
  it('drops lines whose required placeholders are empty', () => {
    expect(renderBlock('A: {{a}}\nB: {{b}}', { a: '1', b: '' })).toBe('A: 1');
  });
  it('drops optional segments only', () => {
    expect(renderBlock('{{a}}[[ | {{b}} BR]][[ | {{c}}]]', { a: 'X', c: 'Y' })).toBe('X | Y');
  });
  it('renders optional placeholders silently', () => {
    expect(renderBlock('{{?i}}{{a}}', { a: 'X' })).toBe('X');
  });
});

describe('offer rendering', () => {
  const pdfLike = DEFAULT_TEMPLATES.find((t) => t.key === 'pdf')!;
  it('produces the PRD example structure', () => {
    const text = renderOffer({ template: pdfLike, units: [villa], currency: 'EGP', global: {}, includeOwner: false });
    expect(text).toContain('MIVIDA\nStandalone Villa\nBUA: 350 SQM\nLand: 500 SQM\n4 Bedrooms\nFully Finished');
    expect(text).toContain('Asking Price: 42,000,000 EGP');
  });
  it('never leaks owner details unless asked', () => {
    const wa = DEFAULT_TEMPLATES.find((t) => t.key === 'whatsapp')!;
    const hidden = renderOffer({ template: wa, units: [villa], currency: 'EGP', global: {}, includeOwner: false });
    expect(hidden).not.toContain('Ahmed');
    const shown = renderOffer({ template: wa, units: [villa], currency: 'EGP', global: {}, includeOwner: true });
    expect(shown).toContain('Ahmed Mohamed');
  });
  it('numbers multiple units and joins them into one message', () => {
    const short = DEFAULT_TEMPLATES.find((t) => t.key === 'short')!;
    const text = renderOffer({ template: short, units: [villa, { ...villa, id: 13, bedrooms: null }], currency: 'EGP', global: {}, includeOwner: false });
    expect(text.split('\n')).toEqual([
      '1) Mivida Standalone Villa | 350 SQM | 4 BR | Fully Finished | 42,000,000 EGP',
      '2) Mivida Standalone Villa | 350 SQM | Fully Finished | 42,000,000 EGP',
    ]);
  });
  it('exposes tokens to strip prices and owner info', () => {
    const t = sensitiveTokens([villa], 'EGP');
    expect(t.price).toContain('42,000,000 EGP');
    expect(t.owner).toContain('01012345678');
  });
});
