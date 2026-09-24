// Offer template engine.
//
// Syntax (kept deliberately small so admins can edit templates safely):
//   {{field}}      value; the whole line is dropped when the value is empty
//   {{?field}}     optional value; renders empty without dropping the line
//   [[ ... ]]      optional segment; dropped if any field inside is empty
//
// Blocks: header (once), unit_block (per unit, joined by separator), footer.

import { formatMoney, formatNumber } from '../../shared/format.js';

export interface TemplateDef {
  key: string;
  name: string;
  description?: string | null;
  header: string;
  unit_block: string;
  separator: string;
  footer: string;
  include_owner: number | boolean;
}

export type Ctx = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{\{(\?)?\s*([a-z0-9_]+)\s*\}\}/gi;

function valueOf(ctx: Ctx, key: string): string {
  const v = ctx[key];
  if (v === null || v === undefined) return '';
  const str = String(v);
  return str.trim() ? str : '';
}

function renderSegment(text: string, ctx: Ctx): string | null {
  let missing = false;
  const out = text.replace(PLACEHOLDER, (_m, _opt, key) => {
    const v = valueOf(ctx, key);
    if (!v) missing = true;
    return v;
  });
  return missing ? null : out;
}

export function renderLine(line: string, ctx: Ctx): string | null {
  // Optional segments first
  let processed = line.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner) => renderSegment(inner, ctx) ?? '');
  let drop = false;
  processed = processed.replace(PLACEHOLDER, (_m, opt, key) => {
    const v = valueOf(ctx, key);
    if (!v && !opt) drop = true;
    return v;
  });
  if (drop) return null;
  return processed;
}

export function renderBlock(block: string, ctx: Ctx): string {
  const lines = block.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const hadContent = line.trim().length > 0;
    const r = renderLine(line, ctx);
    if (r === null) continue;
    // A line that only held optional content that vanished is dropped too.
    if (hadContent && !r.trim()) continue;
    out.push(r.replace(/\s+$/, ''));
  }
  // collapse multiple blank lines
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface UnitForOffer {
  id: number;
  developer?: string | null;
  project?: string | null;
  phase?: string | null;
  unit_number?: string | null;
  property_type?: string | null;
  bua?: number | null;
  land_area?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floors?: number | null;
  finishing?: string | null;
  furnished?: string | null;
  view?: string | null;
  location?: string | null;
  delivery?: string | null;
  asking_price?: number | null;
  original_price?: number | null;
  paid_amount?: number | null;
  remaining_amount?: number | null;
  maintenance?: number | null;
  payment_notes?: string | null;
  status?: string | null;
  last_verified?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  owner_whatsapp?: string | null;
  agent_name?: string | null;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : formatNumber(v));
const plural = (n: number | null | undefined, one: string, many: string) =>
  n === null || n === undefined ? '' : `${n} ${n === 1 ? one : many}`;

export function unitContext(u: UnitForOffer, index: number, total: number, currency: string): Ctx {
  const money = (v: number | null | undefined) => (v === null || v === undefined ? '' : formatMoney(v, currency));
  return {
    index: index + 1,
    index_label: total > 1 ? `${index + 1}) ` : '',
    unit_id: `U-${String(u.id).padStart(5, '0')}`,
    developer: u.developer,
    project: u.project,
    project_upper: u.project?.toUpperCase(),
    phase: u.phase,
    unit_number: u.unit_number,
    type: u.property_type,
    bua: num(u.bua),
    land: num(u.land_area),
    bedrooms: u.bedrooms ?? '',
    bedrooms_label: plural(u.bedrooms, 'Bedroom', 'Bedrooms'),
    bathrooms: u.bathrooms ?? '',
    bathrooms_label: plural(u.bathrooms, 'Bathroom', 'Bathrooms'),
    floors: u.floors ?? '',
    finishing: u.finishing,
    furnished: u.furnished,
    view: u.view,
    location: u.location,
    delivery: u.delivery,
    asking_price: money(u.asking_price),
    original_price: money(u.original_price),
    paid_amount: money(u.paid_amount),
    remaining_amount: money(u.remaining_amount),
    maintenance: money(u.maintenance),
    payment_notes: u.payment_notes,
    status: u.status,
    last_verified: u.last_verified,
    owner_name: u.owner_name,
    owner_phone: u.owner_phone,
    owner_whatsapp: u.owner_whatsapp,
    agent_name: u.agent_name,
  };
}

export interface OfferRenderInput {
  template: TemplateDef;
  units: UnitForOffer[];
  currency: string;
  global: Ctx;
  includeOwner: boolean;
}

export function renderOffer({ template, units, currency, global, includeOwner }: OfferRenderInput) {
  const count = units.length;
  const header = renderBlock(template.header, {
    ...global,
    count,
    count_phrase: count === 1 ? 'is an option' : `are ${count} options`,
  });
  const blocks = units.map((u, i) => {
    const ctx = unitContext(u, i, count, currency);
    if (!includeOwner) {
      ctx.owner_name = '';
      ctx.owner_phone = '';
      ctx.owner_whatsapp = '';
    }
    return renderBlock(template.unit_block, { ...global, ...ctx });
  });
  const sep = template.separator.replace(/\\n/g, '\n');
  const body = blocks.filter(Boolean).join(sep || '\n\n');
  const footer = renderBlock(template.footer, { ...global, count });
  return [header, body, footer].filter((s) => s.trim()).join('\n\n');
}

/**
 * Values that identify sensitive lines. The client strips any line containing
 * one of them for "Copy without price" / "Copy without owner information",
 * which keeps working after the agent edits the generated text.
 */
export function sensitiveTokens(units: UnitForOffer[], currency: string) {
  const price = new Set<string>();
  const owner = new Set<string>();
  for (const u of units) {
    for (const v of [u.asking_price, u.original_price, u.paid_amount, u.remaining_amount, u.maintenance]) {
      if (v !== null && v !== undefined) {
        price.add(formatMoney(v, currency));
        price.add(formatNumber(v));
      }
    }
    for (const v of [u.owner_name, u.owner_phone, u.owner_whatsapp]) if (v) owner.add(v);
  }
  return { price: [...price].filter((t) => t.length > 2), owner: [...owner].filter((t) => t.length > 2) };
}

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    description: 'Friendly message with emoji, ready to paste into WhatsApp.',
    header: 'Hello {{client_name}},\nHere {{count_phrase}} that may interest you:',
    unit_block: [
      '*{{?index_label}}{{project_upper}}*',
      '{{type}}[[ – {{phase}}]]',
      '',
      '📐 BUA: {{bua}} SQM',
      '🌳 Land: {{land}} SQM',
      '🛏 {{bedrooms_label}}',
      '🛁 {{bathrooms_label}}',
      '✨ {{finishing}}',
      '🛋 {{furnished}}',
      '🗓 Delivery: {{delivery}}',
      '👤 Owner: {{owner_name}}[[ – {{owner_phone}}]]',
      '',
      '💰 *Asking Price: {{asking_price}}*',
    ].join('\n'),
    separator: '\n\n———————\n\n',
    footer: 'For more details or to arrange a viewing:\n{{agent_name}}[[ – {{agent_phone}}]]\n{{company_name}}',
    include_owner: 0,
  },
  {
    key: 'short',
    name: 'Short Offer',
    description: 'One line per unit. Good for quick replies.',
    header: '',
    unit_block:
      '{{?index_label}}{{project}} {{type}}[[ | {{bua}} SQM]][[ | {{bedrooms}} BR]][[ | {{finishing}}]][[ | {{asking_price}}]]',
    separator: '\n',
    footer: '{{agent_name}}[[ – {{agent_phone}}]]',
    include_owner: 0,
  },
  {
    key: 'detailed',
    name: 'Detailed Offer',
    description: 'Full specification and payment details.',
    header: 'Dear {{client_name}},\nPlease find below the property details:',
    unit_block: [
      '{{?index_label}}{{project_upper}}',
      '{{type}}',
      'Developer: {{developer}}',
      'Phase: {{phase}}',
      'Location: {{location}}',
      'BUA: {{bua}} SQM',
      'Land: {{land}} SQM',
      'Bedrooms: {{bedrooms}}',
      'Bathrooms: {{bathrooms}}',
      'Floors: {{floors}}',
      'Finishing: {{finishing}}',
      'Furnishing: {{furnished}}',
      'View: {{view}}',
      'Delivery: {{delivery}}',
      'Owner: {{owner_name}}[[ – {{owner_phone}}]]',
      '',
      'Asking Price: {{asking_price}}',
      'Original Price: {{original_price}}',
      'Paid Amount: {{paid_amount}}',
      'Remaining: {{remaining_amount}}',
      'Maintenance: {{maintenance}}',
      'Payment: {{payment_notes}}',
    ].join('\n'),
    separator: '\n\n--------------------\n\n',
    footer: 'Best regards,\n{{agent_name}}\n{{agent_phone}}\n{{company_name}}',
    include_owner: 0,
  },
  {
    key: 'pdf',
    name: 'PDF',
    description: 'Branded PDF brochure with images and plans. The text below is a plain summary.',
    header: '{{company_name}} – Property Offer',
    unit_block: [
      '{{?index_label}}{{project_upper}}',
      '{{type}}',
      'BUA: {{bua}} SQM',
      'Land: {{land}} SQM',
      '{{bedrooms_label}}',
      '{{finishing}}',
      'Delivery: {{delivery}}',
      '',
      'Asking Price: {{asking_price}}',
    ].join('\n'),
    separator: '\n\n',
    footer: '{{agent_name}}[[ – {{agent_phone}}]]',
    include_owner: 0,
  },
  {
    key: 'internal',
    name: 'Internal',
    description: 'For colleagues. Includes unit number, owner and verification details.',
    header: 'Internal – {{count}} unit(s)',
    unit_block: [
      '{{unit_id}} | {{project}}[[ {{phase}}]][[ | Unit {{unit_number}}]]',
      '{{type}}[[ | BUA {{bua}}]][[ | Land {{land}}]][[ | {{bedrooms}} BR]][[ | {{finishing}}]]',
      'Asking: {{asking_price}}[[ | Original: {{original_price}}]]',
      'Paid: {{paid_amount}}[[ | Remaining: {{remaining_amount}}]]',
      'Status: {{status}}[[ | Verified: {{last_verified}}]]',
      'Owner: {{owner_name}}[[ – {{owner_phone}}]]',
      'Agent: {{agent_name}}',
    ].join('\n'),
    separator: '\n\n',
    footer: '',
    include_owner: 1,
  },
];
