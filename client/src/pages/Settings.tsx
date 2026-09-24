import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Empty, Field, Loading, Modal, Spinner, Switch, TagChip, errorMessage, useConfirm, useToast } from '../ui';

type Tab = 'general' | 'security' | 'verification' | 'pdf' | 'templates' | 'master' | 'tags' | 'roles';

export function SettingsPage() {
  const { can } = useAuth();
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'general', label: 'Company', show: can('settings.manage') },
    { key: 'security', label: 'Security', show: can('settings.manage') },
    { key: 'verification', label: 'Verification', show: can('settings.manage') },
    { key: 'pdf', label: 'Offer PDF', show: can('settings.manage') },
    { key: 'templates', label: 'Offer templates', show: can('templates.manage') },
    { key: 'master', label: 'Dropdown values', show: can('masterdata.manage') },
    { key: 'tags', label: 'Tags', show: can('masterdata.manage') },
    { key: 'roles', label: 'Roles & permissions', show: can('roles.manage') },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.key ?? 'general');
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="tabs">
        {visible.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {['general', 'security', 'verification', 'pdf'].includes(tab) && <SystemSettings tab={tab as any} />}
      {tab === 'templates' && <TemplatesSettings />}
      {tab === 'master' && <MasterDataSettings />}
      {tab === 'tags' && <TagsSettings />}
      {tab === 'roles' && <RolesSettings />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SystemSettings({ tab }: { tab: 'general' | 'security' | 'verification' | 'pdf' }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [s, setS] = useState<any | null>(null);
  const [dirty, setDirty] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.get('/api/settings').then(setS).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  if (!s) return <Loading />;
  const set = (section: string, key: string, value: unknown) => {
    setS((p: any) => ({ ...p, [section]: { ...p[section], [key]: value } }));
    setDirty(true);
  };
  const save = async () => {
    try {
      setS(await api.patch('/api/settings', s));
      setDirty(false);
      await refresh();
      toast('Settings saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.set('entity_type', 'company');
    form.set('entity_id', '1');
    form.set('category', 'logo');
    form.append('files', file);
    try {
      const r = await api.upload('/api/files', form);
      setS(await api.patch('/api/settings', { company: { logo_file_id: r.ids[0] } }));
      toast('Logo updated');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const num = (section: string, key: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="input num" type="number" min={0} value={s[section][key]} onChange={(e) => set(section, key, e.target.value === '' ? '' : Number(e.target.value))} />
    </Field>
  );
  const text = (section: string, key: string, label: string) => (
    <Field label={label}><input className="input" value={s[section][key] ?? ''} onChange={(e) => set(section, key, e.target.value)} /></Field>
  );
  const toggle = (section: string, key: string, label: string) => <Switch checked={!!s[section][key]} onChange={(v) => set(section, key, v)} label={label} />;

  return (
    <div className="panel">
      <div className="panel-body stack loose">
        {tab === 'general' && (
          <>
            <div className="row">
              <span className="brand-mark" style={{ width: 48, height: 48, fontSize: 20 }}>{s.company.logo_file_id ? <img src={`/api/public/logo?v=${s.company.logo_file_id}`} alt="Logo" /> : s.company.name.charAt(0)}</span>
              <button className="btn" onClick={() => logoInput.current?.click()}><Upload size={14} /> Upload logo</button>
              {s.company.logo_file_id && <button className="btn ghost" onClick={async () => setS(await api.patch('/api/settings', { company: { logo_file_id: null } }))}>Remove</button>}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </div>
            <div className="form-grid">
              {text('company', 'name', 'Company name')}
              {text('company', 'phone', 'Phone')}
              {text('company', 'email', 'Email')}
              {text('company', 'website', 'Website')}
              {text('company', 'address', 'Address')}
              {text('general', 'currency', 'Currency')}
              {num('general', 'export_log_threshold', 'Log exports of at least N rows', '0 logs every export.')}
            </div>
          </>
        )}
        {tab === 'security' && (
          <div className="form-grid">
            {num('security', 'inactivity_minutes', 'Automatic logout after inactivity (minutes)', '0 disables. Does not apply to “Remember me” sessions.')}
            {num('security', 'session_hours', 'Session length (hours)')}
            {num('security', 'remember_days', '“Remember me” length (days)')}
            {num('security', 'max_login_attempts', 'Failed attempts before lockout')}
            {num('security', 'lockout_minutes', 'Lockout duration (minutes)')}
            {num('security', 'min_password_length', 'Minimum password length')}
          </div>
        )}
        {tab === 'verification' && (
          <>
            <p className="text-2">Inventory is highlighted by how long ago it was last verified.</p>
            <div className="form-grid">
              {num('verification', 'attention_days', '“Needs attention” after (days)')}
              {num('verification', 'outdated_days', '“Potentially outdated” after (days)')}
            </div>
            <div className="row wrap" style={{ gap: 16 }}>
              <span className="fresh current">0–{Number(s.verification.attention_days) - 1} days: Current</span>
              <span className="fresh attention">{s.verification.attention_days}–{Number(s.verification.outdated_days) - 1} days: Needs attention</span>
              <span className="fresh outdated">{s.verification.outdated_days}+ days: Potentially outdated</span>
            </div>
            {toggle('verification', 'notify_agents', 'Notify assigned agents when their units need verification')}
          </>
        )}
        {tab === 'pdf' && (
          <>
            <p className="text-2">Choose what appears on client-facing offer PDFs.</p>
            <div className="stack tight">
              {toggle('pdf', 'show_price', 'Asking price and payment details')}
              {toggle('pdf', 'show_images', 'Property images')}
              {toggle('pdf', 'show_floor_plan', 'Floor plans')}
              {toggle('pdf', 'show_master_plan', 'Master plans')}
              {toggle('pdf', 'show_agent_contact', 'Agent contact information')}
              {toggle('pdf', 'show_unit_number', 'Unit number')}
              {toggle('pdf', 'show_owner', 'Allow agents to include owner information (off = never shown)')}
            </div>
            <div className="form-grid">
              <Field label="Accent colour"><input className="input" type="color" value={s.pdf.accent_color} onChange={(e) => set('pdf', 'accent_color', e.target.value)} style={{ padding: 2 }} /></Field>
              <Field label="Footer disclaimer" className="span-2"><input className="input" value={s.pdf.footer_text} onChange={(e) => set('pdf', 'footer_text', e.target.value)} /></Field>
            </div>
          </>
        )}
        <div><button className="btn primary" disabled={!dirty} onClick={save}>Save changes</button></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const PLACEHOLDERS = ['project', 'project_upper', 'developer', 'phase', 'unit_number', 'unit_id', 'type', 'bua', 'land', 'bedrooms', 'bedrooms_label', 'bathrooms', 'bathrooms_label', 'floors', 'finishing', 'furnished', 'view', 'location', 'delivery', 'asking_price', 'original_price', 'paid_amount', 'remaining_amount', 'maintenance', 'payment_notes', 'status', 'last_verified', 'owner_name', 'owner_phone', 'agent_name', 'agent_phone', 'client_name', 'company_name', 'company_phone', 'date', 'count', 'index_label'];

function TemplatesSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<any[] | null>(null);
  const [key, setKey] = useState('whatsapp');
  const [draft, setDraft] = useState<any | null>(null);
  const [preview, setPreview] = useState('');
  const load = useCallback(async () => {
    const t = await api.get<any[]>('/api/templates');
    setTemplates(t);
    return t;
  }, []);
  useEffect(() => {
    load().then((t) => setDraft(t.find((x) => x.key === key) ?? t[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => api.post('/api/templates/preview', draft).then((r) => setPreview(r.content)).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [draft]);
  if (!templates || !draft) return <Loading />;
  const choose = (k: string) => {
    setKey(k);
    setDraft(templates.find((t) => t.key === k));
  };
  const save = async () => {
    try {
      await api.patch(`/api/templates/${draft.key}`, draft);
      const t = await load();
      setDraft(t.find((x) => x.key === draft.key));
      toast('Template saved');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const reset = async () => {
    if (!(await confirm({ title: 'Reset template to default?', confirmLabel: 'Reset', danger: true }))) return;
    await api.post(`/api/templates/${draft.key}/reset`);
    const t = await load();
    setDraft(t.find((x) => x.key === draft.key));
  };
  const area = (field: string, label: string, rows = 4) => (
    <Field label={label}>
      <textarea className="textarea mono" rows={rows} value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />
    </Field>
  );
  return (
    <div className="stack">
      <div className="btn-group">
        {templates.map((t) => <button key={t.key} className={`btn ${key === t.key ? 'active' : ''}`} onClick={() => choose(t.key)}>{t.name}</button>)}
      </div>
      <div className="grid-2">
        <div className="panel panel-body stack">
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Name"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Description"><input className="input" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          </div>
          {area('header', 'Header (once, before units)', 3)}
          {area('unit_block', 'Unit block (repeated for each unit)', 10)}
          {area('separator', 'Separator between units', 2)}
          {area('footer', 'Footer', 3)}
          <Switch checked={!!draft.include_owner} onChange={(v) => setDraft({ ...draft, include_owner: v ? 1 : 0 })} label="Include owner information by default (only for users allowed to see contacts)" />
          <div className="callout" style={{ fontSize: 12.5 }}>
            <div><code>{'{{field}}'}</code> inserts a value — the whole line is left out when the value is empty.</div>
            <div><code>{'{{?field}}'}</code> inserts a value without removing the line. <code>{'[[ | {{field}} BR]]'}</code> is an optional segment.</div>
            <div style={{ marginTop: 6 }} className="muted">Fields: {PLACEHOLDERS.join(', ')}</div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={save}>Save template</button>
            <button className="btn ghost" onClick={reset}><RotateCcw size={14} /> Reset to default</button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Preview</h2><span className="muted">Sample data</span></div>
          <div className="panel-body" style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{preview || <span className="muted">Nothing to show</span>}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function InlineAdd({ placeholder, onAdd, extra }: { placeholder: string; onAdd: (v: string) => Promise<void>; extra?: React.ReactNode }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v.trim()) return;
    setBusy(true);
    try {
      await onAdd(v.trim());
      setV('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row">
      <input className="input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      {extra}
      <button className="btn" disabled={!v.trim() || busy} onClick={submit}>{busy ? <Spinner /> : <><Plus size={14} /> Add</>}</button>
    </div>
  );
}

function EditableName({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="input sm"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== value && onSave(v.trim()).catch(() => setV(value))}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      style={{ border: '1px solid transparent', background: 'transparent' }}
    />
  );
}

function MasterDataSettings() {
  const { master, reload } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [newProjectDev, setNewProjectDev] = useState<number | ''>('');
  const [category, setCategory] = useState('property_type');
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      const r: any = await fn();
      if (r?.deactivated) toast('In use by existing records, so it was deactivated instead of deleted');
      else if (msg) toast(msg);
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
      throw e;
    }
  };
  if (!master) return <Loading />;
  return (
    <div className="stack loose">
      <p className="text-2">Standard values keep data consistent — “Mivida”, “mivida” and “MIVIDA” are always the same project.</p>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Developers</h2><span className="muted">{master.developers.length}</span></div>
          <div className="panel-body stack">
            <InlineAdd placeholder="New developer" onAdd={(name) => run(() => api.post('/api/master/developers', { name }), 'Developer added')} />
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {master.developers.map((d) => (
                <div key={d.id} className="row" style={{ borderBottom: '1px solid var(--border)', padding: '2px 0', opacity: d.active ? 1 : 0.5 }}>
                  <div className="grow"><EditableName value={d.name} onSave={(name) => run(() => api.patch(`/api/master/developers/${d.id}`, { name }))} /></div>
                  <span className="muted" style={{ fontSize: 12 }}>{d.unit_count} units</span>
                  {!d.active && <button className="btn ghost sm" onClick={() => run(() => api.patch(`/api/master/developers/${d.id}`, { active: true }))}>Reactivate</button>}
                  {!!d.active && <button className="btn ghost sm icon" onClick={async () => (await confirm({ title: `Remove ${d.name}?`, confirmLabel: 'Remove', danger: true })) && run(() => api.delete(`/api/master/developers/${d.id}`))} aria-label="Remove"><Trash2 size={13} /></button>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Projects</h2><span className="muted">{master.projects.length}</span></div>
          <div className="panel-body stack">
            <InlineAdd
              placeholder="New project"
              extra={
                <select className="select" style={{ width: 160 }} value={newProjectDev} onChange={(e) => setNewProjectDev(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Developer…</option>
                  {master.developers.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              }
              onAdd={(name) => run(() => api.post('/api/master/projects', { name, developer_id: newProjectDev || null }), 'Project added')}
            />
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {master.projects.map((p) => (
                <div key={p.id} className="row" style={{ borderBottom: '1px solid var(--border)', padding: '2px 0', opacity: p.active ? 1 : 0.5 }}>
                  <div className="grow"><EditableName value={p.name} onSave={(name) => run(() => api.patch(`/api/master/projects/${p.id}`, { name }))} /></div>
                  <select className="select sm" style={{ width: 140 }} value={p.developer_id ?? ''} onChange={(e) => run(() => api.patch(`/api/master/projects/${p.id}`, { developer_id: e.target.value ? Number(e.target.value) : null }))}>
                    <option value="">No developer</option>
                    {master.developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <span className="muted" style={{ fontSize: 12, width: 56, textAlign: 'right' }}>{p.unit_count} units</span>
                  {!p.active && <button className="btn ghost sm" onClick={() => run(() => api.patch(`/api/master/projects/${p.id}`, { active: true }))}>Reactivate</button>}
                  {!!p.active && <button className="btn ghost sm icon" onClick={async () => (await confirm({ title: `Remove ${p.name}?`, confirmLabel: 'Remove', danger: true })) && run(() => api.delete(`/api/master/projects/${p.id}`))} aria-label="Remove"><Trash2 size={13} /></button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="btn-group">
            {master.categories.map((c) => <button key={c.key} className={`btn sm ${category === c.key ? 'active' : ''}`} onClick={() => setCategory(c.key)}>{c.label}</button>)}
          </div>
        </div>
        <div className="panel-body stack">
          <InlineAdd placeholder="New value" onAdd={(value) => run(() => api.post('/api/master/values', { category, value }), 'Value added')} />
          <div className="row wrap" style={{ gap: 6 }}>
            {(master.values[category] ?? []).map((v) => (
              <span key={v.id} className="tag" style={{ height: 26, opacity: v.active ? 1 : 0.5 }}>
                <EditableName value={v.value} onSave={(value) => run(() => api.patch(`/api/master/values/${v.id}`, { value }), 'Renamed — existing records were updated')} />
                <button onClick={async () => (await confirm({ title: `Remove “${v.value}”?`, message: 'Existing records keep their value.', confirmLabel: 'Remove', danger: true })) && run(() => api.delete(`/api/master/values/${v.id}`))} aria-label="Remove"><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];

function TagsSettings() {
  const { master, reload } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [color, setColor] = useState('blue');
  if (!master) return <Loading />;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <div className="panel">
      <div className="panel-body stack">
        <InlineAdd
          placeholder="New tag, e.g. Motivated Seller"
          extra={<select className="select" style={{ width: 110 }} value={color} onChange={(e) => setColor(e.target.value)}>{COLORS.map((c) => <option key={c}>{c}</option>)}</select>}
          onAdd={(name) => run(() => api.post('/api/master/tags', { name, color }))}
        />
        {master.tags.length === 0 ? <Empty title="No tags yet" /> : (
          <table className="table compact">
            <thead><tr><th>Tag</th><th>Colour</th><th className="right">Used on</th><th /></tr></thead>
            <tbody>
              {master.tags.map((t) => (
                <tr key={t.id}>
                  <td><TagChip tag={t} /></td>
                  <td><select className="select sm" style={{ width: 110 }} value={t.color} onChange={(e) => run(() => api.patch(`/api/master/tags/${t.id}`, { color: e.target.value }))}>{COLORS.map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td className="right num">{t.usage}</td>
                  <td className="right"><button className="btn ghost sm icon" onClick={async () => (await confirm({ title: `Delete tag “${t.name}”?`, message: `It will be removed from ${t.usage} record(s).`, confirmLabel: 'Delete', danger: true })) && run(() => api.delete(`/api/master/tags/${t.id}`))} aria-label="Delete"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RolesSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<{ roles: any[]; catalogue: { key: string; label: string; group: string }[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const load = useCallback(() => api.get('/api/roles').then(setData).catch((e) => toast(errorMessage(e), 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  const groups = useMemo(() => {
    const g = new Map<string, { key: string; label: string }[]>();
    for (const p of data?.catalogue ?? []) g.set(p.group, [...(g.get(p.group) ?? []), p]);
    return [...g.entries()];
  }, [data]);
  if (!data) return <Loading />;
  const toggle = async (role: any, perm: string) => {
    const next = role.permissions.includes(perm) ? role.permissions.filter((p: string) => p !== perm) : [...role.permissions, perm];
    setData({ ...data, roles: data.roles.map((r) => (r.id === role.id ? { ...r, permissions: next } : r)) });
    try {
      await api.patch(`/api/roles/${role.id}`, { permissions: next });
    } catch (e) {
      toast(errorMessage(e), 'error');
      load();
    }
  };
  const remove = async (role: any) => {
    if (!(await confirm({ title: `Delete role ${role.name}?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/api/roles/${role.id}`);
      load();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <p className="text-2">Permissions are configured per role. Changes apply immediately to everyone with that role.</p>
        <button className="btn" onClick={() => setAdding(true)}><Plus size={14} /> New role</button>
      </div>
      <div className="panel table-wrap">
        <table className="table compact perm-table">
          <thead>
            <tr>
              <th>Permission</th>
              {data.roles.map((r) => (
                <th key={r.id}>
                  <div>{r.name}</div>
                  <div className="muted" style={{ fontWeight: 400 }}>{r.user_count} user{r.user_count === 1 ? '' : 's'}</div>
                  {!r.is_system && <button className="btn ghost sm" onClick={() => remove(r)}>Delete</button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, perms]) => (
              <Fragment key={group}>
                <tr><td colSpan={data.roles.length + 1} className="section-title" style={{ paddingTop: 14, marginBottom: 0 }}>{group}</td></tr>
                {perms.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label} <span className="muted mono" style={{ fontSize: 11 }}>{p.key}</span></td>
                    {data.roles.map((r) => (
                      <td key={r.id}>
                        <input type="checkbox" checked={r.permissions.includes(p.key)} disabled={r.key === 'super_admin'} onChange={() => toggle(r, p.key)} aria-label={`${r.name}: ${p.label}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal title="New role" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={async () => {
          try {
            await api.post('/api/roles', { name, permissions: data.roles.find((r) => r.key === 'agent')?.permissions ?? [] });
            setAdding(false);
            setName('');
            load();
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        }}>Create role</button></>}>
          <Field label="Role name" hint="Starts with the Agent permissions; adjust them in the table."><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
