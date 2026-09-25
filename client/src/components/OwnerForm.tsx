import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Field, errorMessage, useToast } from '../ui';
import { AgentSelect, DuplicateDialog, TagPicker, ValueSelect, type DuplicateInfo } from './common';

export interface OwnerDraft {
  name: string;
  name_ar: string;
  address: string;
  primary_phone: string;
  secondary_phone: string;
  whatsapp: string;
  email: string;
  assigned_user_id: number | null;
  source: string;
  status: string;
  tag_ids: number[];
  note: string;
}

export function emptyOwner(userId: number | null): OwnerDraft {
  return { name: '', name_ar: '', address: '', primary_phone: '', secondary_phone: '', whatsapp: '', email: '', assigned_user_id: userId, source: '', status: 'Active', tag_ids: [], note: '' };
}

export function OwnerForm({ owner, onSaved, onCancel }: { owner?: any; onSaved: (id: number) => void; onCancel: () => void }) {
  const { me, can } = useAuth();
  const { master } = useData();
  const toast = useToast();
  const [d, setD] = useState<OwnerDraft>(() =>
    owner
      ? { name: owner.name ?? '', name_ar: owner.name_ar ?? '', address: owner.contact_hidden ? '' : owner.address ?? '', primary_phone: owner.primary_phone ?? '', secondary_phone: owner.secondary_phone ?? '', whatsapp: owner.whatsapp ?? '', email: owner.email ?? '', assigned_user_id: owner.assigned_user_id, source: owner.source ?? '', status: owner.status, tag_ids: (owner.tags ?? []).map((t: any) => t.id), note: '' }
      : emptyOwner(me!.id),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dups, setDups] = useState<DuplicateInfo | null>(null);
  const [liveDups, setLiveDups] = useState<any[]>([]);
  const set = <K extends keyof OwnerDraft>(k: K, v: OwnerDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const contactHidden = owner?.contact_hidden;

  const checkDuplicates = async () => {
    if (!d.primary_phone && !d.email && !d.name) return;
    try {
      const r = await api.post('/api/owners/check-duplicates', { ...d, exclude_id: owner?.id });
      setLiveDups(r.duplicates);
    } catch {
      /* non-blocking */
    }
  };

  const submit = async (e?: FormEvent, confirmDuplicate = false) => {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    const body: Record<string, unknown> = {
      name: d.name,
      name_ar: d.name_ar,
      assigned_user_id: d.assigned_user_id,
      source: d.source,
      status: d.status,
      tag_ids: d.tag_ids,
      confirm_duplicate: confirmDuplicate,
    };
    if (!contactHidden) Object.assign(body, { primary_phone: d.primary_phone, secondary_phone: d.secondary_phone, whatsapp: d.whatsapp, email: d.email, address: d.address });
    try {
      let id: number;
      if (owner) {
        await api.patch(`/api/owners/${owner.id}`, body);
        id = owner.id;
      } else {
        id = (await api.post('/api/owners', body)).id;
        if (d.note.trim()) await api.post('/api/notes', { entity_type: 'owner', entity_id: id, content: d.note });
      }
      toast(owner ? 'Owner updated' : 'Owner added');
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

  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
        <Field label="Full name" required error={errors.name} className="span-2">
          <input className={`input ${errors.name ? 'invalid' : ''}`} autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} onBlur={checkDuplicates} />
        </Field>
        <Field label="Arabic name" className="span-2">
          <input className="input" dir="rtl" value={d.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
        </Field>
        {!contactHidden && (
          <>
            <Field label="Primary phone" error={errors.primary_phone}>
              <input className="input" inputMode="tel" value={d.primary_phone} onChange={(e) => set('primary_phone', e.target.value)} onBlur={checkDuplicates} placeholder="010…" />
            </Field>
            <Field label="WhatsApp" hint={d.primary_phone && !d.whatsapp ? <a href="#" onClick={(e) => { e.preventDefault(); set('whatsapp', d.primary_phone); }}>Same as primary</a> : undefined}>
              <input className="input" inputMode="tel" value={d.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
            </Field>
            <Field label="Secondary phone">
              <input className="input" inputMode="tel" value={d.secondary_phone} onChange={(e) => set('secondary_phone', e.target.value)} onBlur={checkDuplicates} />
            </Field>
            <Field label="Email" error={errors.email}>
              <input className="input" type="email" value={d.email} onChange={(e) => set('email', e.target.value)} onBlur={checkDuplicates} />
            </Field>
            <Field label="Address" className="span-all">
              <input className="input" value={d.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Assigned agent">
          <AgentSelect value={d.assigned_user_id} onChange={(v) => set('assigned_user_id', v)} />
        </Field>
        <Field label="Source">
          <ValueSelect category="source" value={d.source} onChange={(v) => set('source', v)} />
        </Field>
        <Field label="Status">
          <select className="select" value={d.status} onChange={(e) => set('status', e.target.value)}>
            {(master?.statuses.owner ?? []).filter((s) => s !== 'Archived' || can('owners.delete')).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Tags" className="span-all">
          <TagPicker value={d.tag_ids} onChange={(v) => set('tag_ids', v)} />
        </Field>
        {!owner && (
          <Field label="Note" className="span-all" hint="Internal only — never included in offers.">
            <textarea className="textarea" value={d.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Owner willing to negotiate slightly. Call after 5 PM." />
          </Field>
        )}
      </div>
      {liveDups.length > 0 && (
        <div className="callout warn">
          <strong>Possible duplicate:</strong>{' '}
          {liveDups.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ', '}
              <Link to={`/owners/${o.id}`} target="_blank">{o.name}</Link> <span className="muted">({o.reasons.join(', ')})</span>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : owner ? 'Save changes' : 'Add owner'}</button>
      </div>
      {dups && <DuplicateDialog kind="owner" info={dups} onCancel={() => setDups(null)} onCreateAnyway={() => { setDups(null); submit(undefined, true); }} />}
    </form>
  );
}
