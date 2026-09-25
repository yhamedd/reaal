import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Field, MultiSelect, errorMessage, useToast } from '../ui';
import { AgentSelect, MoneyInput, TagPicker, ValueSelect, numToInput } from './common';

interface ReqDraft {
  client_name: string;
  phone: string;
  whatsapp: string;
  assigned_user_id: number | null;
  developer_id: number | null;
  preferred_project_ids: number[];
  property_types: string[];
  min_bua: string;
  max_bua: string;
  min_bedrooms: string;
  min_price: string;
  max_price: string;
  finishing: string;
  delivery_preference: string;
  priority: string;
  status: string;
  tag_ids: number[];
  note: string;
}

export function RequirementForm({ requirement, onSaved, onCancel }: { requirement?: any; onSaved: (id: number) => void; onCancel: () => void }) {
  const { me } = useAuth();
  const { master, values } = useData();
  const toast = useToast();
  const r = requirement;
  const [d, setD] = useState<ReqDraft>(() => ({
    client_name: r?.client_name ?? '',
    phone: r?.phone ?? '',
    whatsapp: r?.whatsapp ?? '',
    assigned_user_id: r ? r.assigned_user_id : me!.id,
    developer_id: r?.developer_id ?? null,
    preferred_project_ids: r?.preferred_project_ids ?? [],
    property_types: r?.property_types ?? [],
    min_bua: numToInput(r?.min_bua),
    max_bua: numToInput(r?.max_bua),
    min_bedrooms: numToInput(r?.min_bedrooms),
    min_price: numToInput(r?.min_price),
    max_price: numToInput(r?.max_price),
    finishing: r?.finishing ?? '',
    delivery_preference: r?.delivery_preference ?? '',
    priority: r?.priority ?? 'Medium',
    status: r?.status ?? 'Active',
    tag_ids: (r?.tags ?? []).map((t: any) => t.id),
    note: '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ReqDraft>(k: K, v: ReqDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const projects = (master?.projects ?? []).filter((p) => p.active && (!d.developer_id || p.developer_id === d.developer_id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const { note, ...rest } = d;
    const body: Record<string, unknown> = { ...rest };
    if (r?.contact_hidden) {
      delete body.phone;
      delete body.whatsapp;
    }
    try {
      let id: number;
      if (r) {
        await api.patch(`/api/requirements/${r.id}`, body);
        id = r.id;
      } else {
        id = (await api.post('/api/requirements', body)).id;
        if (note.trim()) await api.post('/api/notes', { entity_type: 'requirement', entity_id: id, content: note });
      }
      toast(r ? 'Request updated' : 'Request added');
      onSaved(id);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack loose">
      <section>
        <div className="section-title">Client</div>
        <div className="form-grid">
          <Field label="Client name" required error={errors.client_name} className="span-2">
            <input className="input" autoFocus value={d.client_name} onChange={(e) => set('client_name', e.target.value)} />
          </Field>
          {!r?.contact_hidden && (
            <>
              <Field label="Phone">
                <input className="input" inputMode="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="WhatsApp">
                <input className="input" inputMode="tel" value={d.whatsapp} placeholder={d.phone} onChange={(e) => set('whatsapp', e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Assigned agent">
            <AgentSelect value={d.assigned_user_id} onChange={(v) => set('assigned_user_id', v)} />
          </Field>
          <Field label="Priority">
            <select className="select" value={d.priority} onChange={(e) => set('priority', e.target.value)}>
              {(master?.priorities ?? []).map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={d.status} onChange={(e) => set('status', e.target.value)}>
              {(master?.statuses.requirement ?? []).map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </section>
      <section>
        <div className="section-title">What they’re looking for</div>
        <div className="form-grid">
          <Field label="Developer">
            <select className="select" value={d.developer_id ?? ''} onChange={(e) => set('developer_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any</option>
              {(master?.developers ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Preferred projects" className="span-2">
            <MultiSelect options={projects.map((p) => ({ value: p.id, label: p.name }))} value={d.preferred_project_ids} onChange={(v) => set('preferred_project_ids', v)} searchable />
          </Field>
          <Field label="Property type">
            <MultiSelect options={values('property_type').map((v) => ({ value: v, label: v }))} value={d.property_types} onChange={(v) => set('property_types', v)} />
          </Field>
          <Field label="Min BUA (sqm)" error={errors.min_bua}>
            <input className="input num" inputMode="decimal" value={d.min_bua} onChange={(e) => set('min_bua', e.target.value)} />
          </Field>
          <Field label="Max BUA (sqm)" error={errors.max_bua}>
            <input className="input num" inputMode="decimal" value={d.max_bua} onChange={(e) => set('max_bua', e.target.value)} />
          </Field>
          <Field label="Min bedrooms">
            <input className="input num" inputMode="numeric" value={d.min_bedrooms} onChange={(e) => set('min_bedrooms', e.target.value)} />
          </Field>
          <Field label="Min price" error={errors.min_price}>
            <MoneyInput value={d.min_price} onChange={(v) => set('min_price', v)} />
          </Field>
          <Field label="Max price" error={errors.max_price}>
            <MoneyInput value={d.max_price} onChange={(v) => set('max_price', v)} />
          </Field>
          <Field label="Finishing">
            <ValueSelect category="finishing" value={d.finishing} onChange={(v) => set('finishing', v)} placeholder="Any" />
          </Field>
          <Field label="Delivery preference">
            <input className="input" value={d.delivery_preference} placeholder="e.g. Ready, 2027" onChange={(e) => set('delivery_preference', e.target.value)} />
          </Field>
          <Field label="Tags" className="span-all">
            <TagPicker value={d.tag_ids} onChange={(v) => set('tag_ids', v)} />
          </Field>
          {!r && (
            <Field label="Notes" className="span-all" hint="Internal only.">
              <textarea className="textarea" value={d.note} onChange={(e) => set('note', e.target.value)} />
            </Field>
          )}
        </div>
      </section>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : r ? 'Save changes' : 'Add request'}</button>
      </div>
    </form>
  );
}
