import { useData } from '../data';
import { Field, MultiSelect, Switch } from '../ui';
import type { UnitFilters } from '../../../shared/filters';
import { formatMoneyShort, parseLooseNumber } from '../../../shared/format';

const VERIFICATION = [
  { value: 'current', label: 'Current' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'outdated', label: 'Potentially outdated' },
  { value: 'never', label: 'Never verified' },
] as const;

function NumRange({ label, min, max, onChange, money, single }: { label: string; min?: number; max?: number; onChange: (min?: number, max?: number) => void; money?: boolean; single?: boolean }) {
  const parse = (v: string) => {
    const n = parseLooseNumber(v);
    return n === undefined || Number.isNaN(n) ? undefined : n;
  };
  const show = (v?: number) => (v === undefined ? '' : money ? formatMoneyShort(v) : String(v));
  return (
    <Field label={label}>
      <div className="range">
        <input className="input" placeholder="Min" defaultValue={show(min)} key={`min-${min}`} onBlur={(e) => onChange(parse(e.target.value), max)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        {!single && <span className="muted">–</span>}
        {!single && <input className="input" placeholder="Max" defaultValue={show(max)} key={`max-${max}`} onBlur={(e) => onChange(min, parse(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}
      </div>
    </Field>
  );
}

export function InventoryFilters({ filters, onChange, focus }: { filters: UnitFilters; onChange: (f: UnitFilters) => void; focus?: string | null }) {
  const { master, users, values } = useData();
  const set = (patch: Partial<UnitFilters>) => onChange({ ...filters, ...patch });
  const projects = (master?.projects ?? []).filter((p) => !filters.developer_ids?.length || (p.developer_id && filters.developer_ids.includes(p.developer_id)));
  const highlight = (key: string) => (focus === key ? { outline: '2px solid var(--focus)', outlineOffset: 4, borderRadius: 4 } : undefined);

  return (
    <div className="stack">
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div style={highlight('status')}>
          <Field label="Status">
            <MultiSelect options={(master?.statuses.unit ?? []).map((s) => ({ value: s, label: s }))} value={filters.status ?? []} onChange={(v) => set({ status: v })} />
          </Field>
        </div>
        <div style={highlight('verification')}>
          <Field label="Verification">
            <MultiSelect options={VERIFICATION.map((v) => ({ value: v.value, label: v.label }))} value={(filters.verification ?? []) as string[]} onChange={(v) => set({ verification: v as UnitFilters['verification'] })} />
          </Field>
        </div>
        <div style={highlight('developer')}>
          <Field label="Developer">
            <MultiSelect options={(master?.developers ?? []).map((d) => ({ value: d.id, label: d.name }))} value={filters.developer_ids ?? []} onChange={(v) => set({ developer_ids: v })} />
          </Field>
        </div>
        <div style={highlight('project')}>
          <Field label="Project">
            <MultiSelect options={projects.map((p) => ({ value: p.id, label: p.name }))} value={filters.project_ids ?? []} onChange={(v) => set({ project_ids: v })} searchable />
          </Field>
        </div>
        <div style={highlight('property_type')}>
          <Field label="Property type">
            <MultiSelect options={values('property_type').map((v) => ({ value: v, label: v }))} value={filters.property_types ?? []} onChange={(v) => set({ property_types: v })} />
          </Field>
        </div>
        <div style={highlight('finishing')}>
          <Field label="Finishing">
            <MultiSelect options={values('finishing').map((v) => ({ value: v, label: v }))} value={filters.finishing ?? []} onChange={(v) => set({ finishing: v })} />
          </Field>
        </div>
        <div style={highlight('asking_price')} className="span-all">
          <NumRange label="Asking price" money min={filters.price_min} max={filters.price_max} onChange={(a, b) => set({ price_min: a, price_max: b })} />
        </div>
        <div style={highlight('bua')}>
          <NumRange label="BUA (sqm)" min={filters.bua_min} max={filters.bua_max} onChange={(a, b) => set({ bua_min: a, bua_max: b })} />
        </div>
        <div style={highlight('land_area')}>
          <NumRange label="Land (sqm)" min={filters.land_min} max={filters.land_max} onChange={(a, b) => set({ land_min: a, land_max: b })} />
        </div>
        <div style={highlight('bedrooms')}>
          <NumRange label="Bedrooms" min={filters.bedrooms_min} max={filters.bedrooms_max} onChange={(a, b) => set({ bedrooms_min: a, bedrooms_max: b })} />
        </div>
        <div style={highlight('bathrooms')}>
          <NumRange label="Bathrooms (min)" single min={filters.bathrooms_min} onChange={(a) => set({ bathrooms_min: a })} />
        </div>
        <div style={highlight('phase')}>
          <Field label="Phase contains">
            <input className="input" defaultValue={filters.phase ?? ''} key={filters.phase ?? ''} onBlur={(e) => set({ phase: e.target.value || undefined })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </Field>
        </div>
        <div style={highlight('delivery')}>
          <Field label="Delivery contains">
            <input className="input" defaultValue={filters.delivery ?? ''} key={filters.delivery ?? ''} placeholder="e.g. 2027, Ready" onBlur={(e) => set({ delivery: e.target.value || undefined })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </Field>
        </div>
        <div style={highlight('agent_name')}>
          <Field label="Assigned agent">
            <MultiSelect options={users.map((u) => ({ value: u.id, label: u.name }))} value={filters.assigned_user_ids ?? []} onChange={(v) => set({ assigned_user_ids: v })} />
          </Field>
        </div>
        <div style={highlight('tags')}>
          <Field label="Tags">
            <MultiSelect options={(master?.tags ?? []).map((t) => ({ value: t.id, label: t.name }))} value={filters.tag_ids ?? []} onChange={(v) => set({ tag_ids: v })} />
          </Field>
        </div>
        <div style={highlight('updated_at')}>
          <Field label="Updated from">
            <input className="input" type="date" value={filters.updated_from ?? ''} onChange={(e) => set({ updated_from: e.target.value || undefined })} />
          </Field>
        </div>
        <Field label="Updated to">
          <input className="input" type="date" value={filters.updated_to ?? ''} onChange={(e) => set({ updated_to: e.target.value || undefined })} />
        </Field>
        <Field label="Media">
          <select className="select" value={filters.has_media === undefined ? '' : filters.has_media ? 'yes' : 'no'} onChange={(e) => set({ has_media: e.target.value === '' ? undefined : e.target.value === 'yes' })}>
            <option value="">Any</option>
            <option value="yes">Has photos / files</option>
            <option value="no">No media</option>
          </select>
        </Field>
      </div>
      <div className="stack tight">
        <Switch checked={!!filters.mine} onChange={(v) => set({ mine: v || undefined })} label="Only my listings" />
        <Switch checked={!!filters.include_archived} onChange={(v) => set({ include_archived: v || undefined })} label="Include archived units" />
      </div>
    </div>
  );
}

/** Human-readable chips describing active filters. */
export function describeFilters(f: UnitFilters, lookup: { project: (id: number) => string; developer: (id: number) => string; user: (id: number) => string; tag: (id: number) => string }) {
  const chips: { key: keyof UnitFilters | string; label: string; clear: Partial<UnitFilters> }[] = [];
  const list = (arr: (string | number)[] | undefined, fn: (v: any) => string) => (arr ?? []).map(fn).join(', ');
  const range = (label: string, a?: number, b?: number, money = false, suffix = '') => {
    const fmt = (v: number) => (money ? formatMoneyShort(v) : String(v));
    if (a !== undefined && b !== undefined) return `${label}: ${fmt(a)} to ${fmt(b)}${suffix}`;
    if (a !== undefined) return `${label}: ${fmt(a)}+${suffix}`;
    if (b !== undefined) return `${label}: up to ${fmt(b)}${suffix}`;
    return null;
  };
  if (f.status?.length) chips.push({ key: 'status', label: `Status: ${f.status.join(', ')}`, clear: { status: undefined } });
  if (f.developer_ids?.length) chips.push({ key: 'developer_ids', label: `Developer: ${list(f.developer_ids, lookup.developer)}`, clear: { developer_ids: undefined } });
  if (f.project_ids?.length) chips.push({ key: 'project_ids', label: `Project: ${list(f.project_ids, lookup.project)}`, clear: { project_ids: undefined } });
  if (f.property_types?.length) chips.push({ key: 'property_types', label: `Type: ${f.property_types.join(', ')}`, clear: { property_types: undefined } });
  const beds = range('Bedrooms', f.bedrooms_min, f.bedrooms_max);
  if (beds) chips.push({ key: 'bedrooms', label: beds, clear: { bedrooms_min: undefined, bedrooms_max: undefined } });
  if (f.bathrooms_min !== undefined) chips.push({ key: 'bathrooms', label: `Bathrooms: ${f.bathrooms_min}+`, clear: { bathrooms_min: undefined } });
  const price = range('Price', f.price_min, f.price_max, true);
  if (price) chips.push({ key: 'price', label: price, clear: { price_min: undefined, price_max: undefined } });
  const bua = range('BUA', f.bua_min, f.bua_max, false, ' sqm');
  if (bua) chips.push({ key: 'bua', label: bua, clear: { bua_min: undefined, bua_max: undefined } });
  const land = range('Land', f.land_min, f.land_max, false, ' sqm');
  if (land) chips.push({ key: 'land', label: land, clear: { land_min: undefined, land_max: undefined } });
  if (f.finishing?.length) chips.push({ key: 'finishing', label: `Finishing: ${f.finishing.join(', ')}`, clear: { finishing: undefined } });
  if (f.phase) chips.push({ key: 'phase', label: `Phase: ${f.phase}`, clear: { phase: undefined } });
  if (f.delivery) chips.push({ key: 'delivery', label: `Delivery: ${f.delivery}`, clear: { delivery: undefined } });
  if (f.assigned_user_ids?.length) chips.push({ key: 'agents', label: `Agent: ${list(f.assigned_user_ids, lookup.user)}`, clear: { assigned_user_ids: undefined } });
  if (f.tag_ids?.length) chips.push({ key: 'tags', label: `Tags: ${list(f.tag_ids, lookup.tag)}`, clear: { tag_ids: undefined } });
  if (f.verification?.length) chips.push({ key: 'verification', label: `Verification: ${f.verification.map((v) => VERIFICATION.find((x) => x.value === v)?.label ?? v).join(', ')}`, clear: { verification: undefined } });
  if (f.updated_from || f.updated_to) chips.push({ key: 'updated', label: `Updated: ${f.updated_from ?? '…'} → ${f.updated_to ?? '…'}`, clear: { updated_from: undefined, updated_to: undefined } });
  if (f.created_from) chips.push({ key: 'created', label: `Added since ${f.created_from}`, clear: { created_from: undefined } });
  if (f.has_media !== undefined) chips.push({ key: 'media', label: f.has_media ? 'Has media' : 'No media', clear: { has_media: undefined } });
  if (f.mine) chips.push({ key: 'mine', label: 'My listings', clear: { mine: undefined } });
  if (f.include_archived) chips.push({ key: 'archived', label: 'Including archived', clear: { include_archived: undefined } });
  return chips;
}
