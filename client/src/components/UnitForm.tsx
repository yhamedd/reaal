import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, UserPlus, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Combobox, Field, errorMessage, useToast } from '../ui';
import { AgentSelect, DuplicateDialog, MoneyInput, TagPicker, ValueSelect, numToInput, useSessionDraft, type DuplicateInfo } from './common';

interface OwnerRef {
  id: number;
  name: string;
  primary_phone?: string | null;
  unit_count?: number;
}

interface UnitDraft {
  owner: OwnerRef | null;
  newOwner: { name: string; primary_phone: string; whatsapp: string; email: string } | null;
  developer_id: number | null;
  project_id: number | null;
  phase: string;
  unit_number: string;
  property_type: string;
  bua: string;
  land_area: string;
  bedrooms: string;
  bathrooms: string;
  floors: string;
  finishing: string;
  furnished: string;
  view: string;
  location: string;
  delivery: string;
  asking_price: string;
  original_price: string;
  paid_amount: string;
  remaining_amount: string;
  maintenance: string;
  payment_notes: string;
  status: string;
  assigned_user_id: number | null;
  source: string;
  last_verified: string;
  tag_ids: number[];
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function fromUnit(u: any): UnitDraft {
  return {
    owner: u.owner_id ? { id: u.owner_id, name: u.owner_name, primary_phone: u.owner_phone } : null,
    newOwner: null,
    developer_id: u.developer_id,
    project_id: u.project_id,
    phase: u.phase ?? '',
    unit_number: u.unit_number ?? '',
    property_type: u.property_type ?? '',
    bua: numToInput(u.bua),
    land_area: numToInput(u.land_area),
    bedrooms: numToInput(u.bedrooms),
    bathrooms: numToInput(u.bathrooms),
    floors: numToInput(u.floors),
    finishing: u.finishing ?? '',
    furnished: u.furnished ?? '',
    view: u.view ?? '',
    location: u.location ?? '',
    delivery: u.delivery ?? '',
    asking_price: numToInput(u.asking_price),
    original_price: numToInput(u.original_price),
    paid_amount: numToInput(u.paid_amount),
    remaining_amount: numToInput(u.remaining_amount),
    maintenance: numToInput(u.maintenance),
    payment_notes: u.payment_notes ?? '',
    status: u.status,
    assigned_user_id: u.assigned_user_id,
    source: u.source ?? '',
    last_verified: u.last_verified ?? '',
    tag_ids: (u.tags ?? []).map((t: any) => t.id),
    note: '',
  };
}

export function UnitForm({ unit, initialOwner, onSaved, onCancel }: { unit?: any; initialOwner?: OwnerRef; onSaved: (id: number) => void; onCancel: () => void }) {
  const { me, can } = useAuth();
  const { master } = useData();
  const toast = useToast();
  const blank: UnitDraft = {
    owner: initialOwner ?? null, newOwner: null, developer_id: null, project_id: null, phase: '', unit_number: '', property_type: '', bua: '', land_area: '', bedrooms: '',
    bathrooms: '', floors: '', finishing: '', furnished: '', view: '', location: '', delivery: '', asking_price: '', original_price: '', paid_amount: '', remaining_amount: '',
    maintenance: '', payment_notes: '', status: 'Available', assigned_user_id: me!.id, source: '', last_verified: today(), tag_ids: [], note: '',
  };
  // New units keep a session draft so switching to create an owner or opening another tab never loses progress.
  const [draft, setDraft, clearDraft, restored] = useSessionDraft<UnitDraft>(unit ? `reaal.draft.unit.${unit.id}` : 'reaal.draft.unit.new', unit ? fromUnit(unit) : blank);
  const [editDraft, setEditDraft] = useState<UnitDraft>(() => (unit ? fromUnit(unit) : blank));
  const d = unit ? editDraft : draft;
  const setDLocal: (fn: UnitDraft | ((p: UnitDraft) => UnitDraft)) => void = unit ? setEditDraft : setDraft;
  const set = <K extends keyof UnitDraft>(k: K, v: UnitDraft[K]) => setDLocal((p: UnitDraft) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (initialOwner && !unit) set('owner', initialOwner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showMore, setShowMore] = useState(!!unit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dups, setDups] = useState<DuplicateInfo | null>(null);
  const [liveDups, setLiveDups] = useState<any[]>([]);

  const projects = (master?.projects ?? []).filter((p) => (p.active || p.id === d.project_id) && (!d.developer_id || p.developer_id === d.developer_id || p.id === d.project_id));
  const searchOwners = useCallback(async (q: string) => {
    const r = await api.get(`/api/owners?limit=8&q=${encodeURIComponent(q)}`);
    return r.rows as OwnerRef[];
  }, []);

  const checkDuplicates = async () => {
    if (!d.project_id || !d.unit_number.trim()) return setLiveDups([]);
    try {
      const r = await api.post('/api/units/check-duplicates', { project_id: d.project_id, unit_number: d.unit_number, phase: d.phase, exclude_id: unit?.id });
      setLiveDups(r.duplicates);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    checkDuplicates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.project_id]);

  const submit = async (e?: FormEvent, confirmDuplicate = false) => {
    e?.preventDefault();
    setErrors({});
    if (d.newOwner && !d.newOwner.name.trim()) {
      setErrors({ owner: 'Enter the new owner’s name' });
      return;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      developer_id: d.developer_id,
      project_id: d.project_id,
      phase: d.phase,
      unit_number: d.unit_number,
      property_type: d.property_type,
      bua: d.bua,
      land_area: d.land_area,
      bedrooms: d.bedrooms,
      bathrooms: d.bathrooms,
      floors: d.floors,
      finishing: d.finishing,
      furnished: d.furnished,
      view: d.view,
      location: d.location,
      delivery: d.delivery,
      asking_price: d.asking_price,
      original_price: d.original_price,
      paid_amount: d.paid_amount,
      remaining_amount: d.remaining_amount,
      maintenance: d.maintenance,
      payment_notes: d.payment_notes,
      status: d.status,
      assigned_user_id: d.assigned_user_id,
      source: d.source,
      last_verified: d.last_verified,
      tag_ids: d.tag_ids,
      owner_id: d.newOwner ? null : d.owner?.id ?? null,
      confirm_duplicate: confirmDuplicate,
    };
    if (d.newOwner && !unit) body.new_owner = d.newOwner;
    try {
      let id: number;
      if (unit) {
        await api.patch(`/api/units/${unit.id}`, body);
        id = unit.id;
      } else {
        id = (await api.post('/api/units', body)).id;
        if (d.note.trim()) await api.post('/api/notes', { entity_type: 'unit', entity_id: id, content: d.note });
      }
      clearDraft();
      toast(unit ? 'Unit updated' : 'Unit added');
      onSaved(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDups(err.body);
      else {
        if (err instanceof ApiError) setErrors(err.fields);
        toast(errorMessage(err), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = () => {
    clearDraft();
    setDLocal(blank);
  };

  const num = (k: keyof UnitDraft, label: string, placeholder?: string) => (
    <Field label={label} error={errors[k as string]}>
      <input className={`input num ${errors[k as string] ? 'invalid' : ''}`} inputMode="decimal" value={d[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as any)} />
    </Field>
  );
  const money = (k: keyof UnitDraft, label: string) => (
    <Field label={label} error={errors[k as string]}>
      <MoneyInput value={d[k] as string} onChange={(v) => set(k, v as any)} invalid={!!errors[k as string]} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="stack loose">
      {restored && !unit && (
        <div className="callout row between">
          <span>Your unsaved draft was restored.</span>
          <button type="button" className="btn sm ghost" onClick={discardDraft}>Discard draft</button>
        </div>
      )}

      <section>
        <div className="section-title">Owner</div>
        {d.newOwner ? (
          <div className="panel panel-body stack">
            <div className="row between">
              <strong className="row"><UserPlus size={15} /> New owner</strong>
              <button type="button" className="btn ghost sm" onClick={() => set('newOwner', null)}><X size={14} /> Pick existing instead</button>
            </div>
            <div className="form-grid">
              <Field label="Full name" required error={errors.owner}>
                <input className="input" value={d.newOwner.name} autoFocus onChange={(e) => set('newOwner', { ...d.newOwner!, name: e.target.value })} />
              </Field>
              <Field label="Primary phone">
                <input className="input" inputMode="tel" value={d.newOwner.primary_phone} onChange={(e) => set('newOwner', { ...d.newOwner!, primary_phone: e.target.value })} />
              </Field>
              <Field label="WhatsApp">
                <input className="input" inputMode="tel" value={d.newOwner.whatsapp} placeholder={d.newOwner.primary_phone} onChange={(e) => set('newOwner', { ...d.newOwner!, whatsapp: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={d.newOwner.email} onChange={(e) => set('newOwner', { ...d.newOwner!, email: e.target.value })} />
              </Field>
            </div>
          </div>
        ) : (
          <Field label="Search owner by name or phone" error={errors.owner_id}>
            <Combobox<OwnerRef>
              value={d.owner}
              display={(o) => `${o.name}${o.primary_phone ? ` · ${o.primary_phone}` : ''}`}
              search={searchOwners}
              renderItem={(o) => (
                <span className="grow">
                  <strong>{o.name}</strong> <span className="muted">{o.primary_phone} · {o.unit_count ?? 0} units</span>
                </span>
              )}
              onSelect={(o) => set('owner', o)}
              placeholder="Type a name or phone number…"
              onCreate={can('owners.create') && !unit ? (q) => set('newOwner', { name: /^[\d\s+()-]+$/.test(q) ? '' : q, primary_phone: /^[\d\s+()-]+$/.test(q) ? q : '', whatsapp: '', email: '' }) : undefined}
              createLabel={(q) => `+ Create new owner “${q}”`}
            />
          </Field>
        )}
        {!d.owner && !d.newOwner && can('owners.create') && !unit && (
          <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => set('newOwner', { name: '', primary_phone: '', whatsapp: '', email: '' })}>
            <UserPlus size={14} /> Owner doesn’t exist yet? Create new owner
          </button>
        )}
      </section>

      <section>
        <div className="section-title">Property</div>
        <div className="form-grid">
          <Field label="Developer">
            <select className="select" value={d.developer_id ?? ''} onChange={(e) => set('developer_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {(master?.developers ?? []).filter((x) => x.active || x.id === d.developer_id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Project" error={errors.project_id}>
            <select
              className="select"
              value={d.project_id ?? ''}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const p = master?.projects.find((x) => x.id === id);
                setDLocal((prev: UnitDraft) => ({ ...prev, project_id: id, developer_id: p?.developer_id ?? prev.developer_id, location: prev.location || p?.location || '' }));
              }}
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Phase">
            <input className="input" value={d.phase} onChange={(e) => set('phase', e.target.value)} onBlur={checkDuplicates} />
          </Field>
          <Field label="Unit number" error={errors.unit_number}>
            <input className="input" value={d.unit_number} onChange={(e) => set('unit_number', e.target.value)} onBlur={checkDuplicates} />
          </Field>
          <Field label="Property type">
            <ValueSelect category="property_type" value={d.property_type} onChange={(v) => set('property_type', v)} />
          </Field>
          {num('bua', 'BUA (sqm)')}
          {num('land_area', 'Land (sqm)')}
          {num('bedrooms', 'Bedrooms')}
          {num('bathrooms', 'Bathrooms')}
          <Field label="Finishing">
            <ValueSelect category="finishing" value={d.finishing} onChange={(v) => set('finishing', v)} />
          </Field>
          <Field label="Delivery">
            <input className="input" value={d.delivery} placeholder="e.g. 2027 or Ready" onChange={(e) => set('delivery', e.target.value)} />
          </Field>
        </div>
        {liveDups.length > 0 && (
          <div className="callout warn" style={{ marginTop: 10 }}>
            <strong>Possible duplicate found:</strong>{' '}
            {liveDups.map((u, i) => (
              <span key={u.id}>
                {i > 0 && ', '}
                <Link to={`/inventory/${u.id}`} target="_blank">{u.project} | {u.unit_number}</Link>
                {u.phase ? ` (${u.phase})` : ''} – {u.status}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-title">Price</div>
        <div className="form-grid">
          {money('asking_price', 'Asking price')}
          {money('original_price', 'Original price')}
          {money('paid_amount', 'Paid amount')}
          {money('remaining_amount', 'Remaining amount')}
        </div>
      </section>

      <section>
        <div className="section-title">Status</div>
        <div className="form-grid">
          <Field label="Status" error={errors.status}>
            <select className="select" value={d.status} onChange={(e) => set('status', e.target.value)}>
              {(master?.statuses.unit ?? []).filter((s) => s !== 'Archived' || can('inventory.delete') || d.status === 'Archived').map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Assigned agent">
            <AgentSelect value={d.assigned_user_id} onChange={(v) => set('assigned_user_id', v)} />
          </Field>
          <Field label="Last verified">
            <input className="input" type="date" value={d.last_verified} onChange={(e) => set('last_verified', e.target.value)} />
          </Field>
          <Field label="Tags" className="span-2">
            <TagPicker value={d.tag_ids} onChange={(v) => set('tag_ids', v)} />
          </Field>
        </div>
      </section>

      <section>
        <button type="button" className="btn ghost sm" onClick={() => setShowMore((s) => !s)}>
          {showMore ? <ChevronDown size={15} /> : <ChevronRight size={15} />} More details
        </button>
        {showMore && (
          <div className="form-grid" style={{ marginTop: 10 }}>
            {num('floors', 'Floors')}
            <Field label="Furnishing">
              <select className="select" value={d.furnished} onChange={(e) => set('furnished', e.target.value)}>
                <option value="">—</option>
                {(master?.furnishing ?? []).map((f) => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="View">
              <ValueSelect category="view" value={d.view} onChange={(v) => set('view', v)} />
            </Field>
            <Field label="Location">
              <input className="input" value={d.location} onChange={(e) => set('location', e.target.value)} />
            </Field>
            {money('maintenance', 'Maintenance')}
            <Field label="Source">
              <ValueSelect category="source" value={d.source} onChange={(v) => set('source', v)} />
            </Field>
            <Field label="Payment notes" className="span-all">
              <textarea className="textarea" value={d.payment_notes} onChange={(e) => set('payment_notes', e.target.value)} placeholder="Installments, over-payment, cash required…" />
            </Field>
            {!unit && (
              <Field label="Internal note" className="span-all" hint="Internal only — never included in offers.">
                <textarea className="textarea" value={d.note} onChange={(e) => set('note', e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </section>

      <div className="row" style={{ justifyContent: 'flex-end', position: 'sticky', bottom: -16, background: 'var(--surface)', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn" onClick={onCancel}>{unit ? 'Cancel' : 'Close (keeps draft)'}</button>
        <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : unit ? 'Save changes' : 'Save unit'}</button>
      </div>
      {dups && <DuplicateDialog kind="unit" info={dups} onCancel={() => setDups(null)} onCreateAnyway={() => { setDups(null); submit(undefined, true); }} />}
    </form>
  );
}
