import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, KeyRound, Lock, MoreHorizontal, Pencil, Plus, UserX, UserCheck } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Avatar, Dropdown, Field, Loading, Modal, StatusBadge, copyText, dateTime, errorMessage, timeAgo, useConfirm, useToast } from '../ui';

interface TeamUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role_id: number;
  role_name: string;
  role_key: string | null;
  status: string;
  last_login: string | null;
  last_activity: string | null;
  records_added: number;
  offers_created: number;
  locked: boolean;
  must_change_password: number;
}

export function TeamPage() {
  const { me } = useAuth();
  const { reload } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [roles, setRoles] = useState<{ id: number; name: string; key: string | null }[]>([]);
  const [editing, setEditing] = useState<TeamUser | 'new' | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const highlight = Number(params.get('user')) || null;

  const load = useCallback(() => {
    api.get<TeamUser[]>('/api/users').then(setUsers).catch((e) => toast(errorMessage(e), 'error'));
    api.get('/api/roles').then((r) => setRoles(r.roles)).catch(() => undefined);
  }, [toast]);
  useEffect(load, [load]);

  const isSuper = me!.role_key === 'super_admin';
  const canTouch = (u: TeamUser) => isSuper || u.role_key !== 'super_admin';

  const setStatus = async (u: TeamUser, status: 'active' | 'disabled') => {
    if (status === 'disabled' && !(await confirm({ title: `Disable ${u.name}?`, message: 'They will be signed out immediately and cannot sign in until re-enabled. Their records and history stay intact.', confirmLabel: 'Disable', danger: true }))) return;
    try {
      await api.patch(`/api/users/${u.id}`, { status });
      toast(status === 'disabled' ? `${u.name} disabled` : `${u.name} re-enabled`);
      load();
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const resetPassword = async (u: TeamUser, mode: 'link' | 'temporary') => {
    try {
      const r = await api.post(`/api/users/${u.id}/reset-password`, { mode });
      if (mode === 'link') setSecret({ title: `Reset link for ${u.name}`, value: `${window.location.origin}${r.reset_path}`, note: 'Send this link to them privately. It works once and expires in 24 hours.' });
      else setSecret({ title: `Temporary password for ${u.name}`, value: r.temporary_password, note: 'They will be asked to choose a new password when they sign in. Existing sessions were signed out.' });
      load();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const unlock = async (u: TeamUser) => {
    await api.post(`/api/users/${u.id}/unlock`);
    toast(`${u.name} unlocked`);
    load();
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">Manage who can access the system and what they can do.</div>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={15} /> Add User</button>
      </div>
      <div className="panel">
        {!users ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th className="right">Records added</th><th className="right">Offers</th><th>Last activity</th><th /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={highlight === u.id ? { background: 'var(--accent-soft)' } : undefined}>
                    <td><span className="row"><Avatar name={u.name} /> <strong>{u.name}</strong>{u.id === me!.id && <span className="badge gray">You</span>}</span></td>
                    <td>{u.email}</td>
                    <td>{u.role_name}</td>
                    <td className="row" style={{ gap: 4 }}>
                      <StatusBadge status={u.status} />
                      {u.locked && <span className="badge red"><Lock size={10} /> Locked</span>}
                      {!!u.must_change_password && <span className="badge yellow">Temp password</span>}
                    </td>
                    <td className="muted nowrap" title={dateTime(u.last_login)}>{u.last_login ? timeAgo(u.last_login) : 'Never'}</td>
                    <td className="right num">{u.records_added}</td>
                    <td className="right num">{u.offers_created}</td>
                    <td className="muted nowrap">{timeAgo(u.last_activity)}</td>
                    <td className="right">
                      {canTouch(u) && (
                        <Dropdown className="btn ghost sm icon" label={<MoreHorizontal size={15} />} align="right" title="Actions">
                          {(close) => (
                            <div className="menu">
                              <button onClick={() => { close(); setEditing(u); }}><Pencil size={14} /> Edit / change role</button>
                              <button onClick={() => { close(); resetPassword(u, 'link'); }}><KeyRound size={14} /> Reset password (link)</button>
                              <button onClick={() => { close(); resetPassword(u, 'temporary'); }}><KeyRound size={14} /> Set temporary password</button>
                              {u.locked && <button onClick={() => { close(); unlock(u); }}><Lock size={14} /> Unlock account</button>}
                              {u.id !== me!.id && <div className="sep" />}
                              {u.id !== me!.id && (u.status === 'active'
                                ? <button className="danger" onClick={() => { close(); setStatus(u, 'disabled'); }}><UserX size={14} /> Disable</button>
                                : <button onClick={() => { close(); setStatus(u, 'active'); }}><UserCheck size={14} /> Re-enable</button>)}
                            </div>
                          )}
                        </Dropdown>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          roles={roles.filter((r) => isSuper || r.key !== 'super_admin' || (editing !== 'new' && editing.role_id === r.id))}
          onClose={() => setEditing(null)}
          onSaved={(temp, name) => {
            setEditing(null);
            load();
            reload();
            if (temp) setSecret({ title: `${name} was added`, value: temp, note: 'Share this temporary password privately. They must choose a new password on first sign-in.' });
          }}
        />
      )}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} footer={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}>
          <div className="stack">
            <div className="row">
              <input className="input mono" readOnly value={secret.value} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => copyText(secret.value).then(() => toast('Copied'))}><Copy size={14} /> Copy</button>
            </div>
            <p className="muted">{secret.note} This won’t be shown again.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UserDialog({ user, roles, onClose, onSaved }: { user: TeamUser | null; roles: { id: number; name: string }[]; onClose: () => void; onSaved: (temp: string | null, name: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [roleId, setRoleId] = useState<number>(user?.role_id ?? roles.find((r) => r.name === 'Agent')?.id ?? roles[0]?.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      if (user) {
        await api.patch(`/api/users/${user.id}`, { name, email, phone, role_id: roleId });
        toast('User updated');
        onSaved(null, name);
      } else {
        const r = await api.post('/api/users', { name, email, phone, role_id: roleId });
        onSaved(r.temporary_password, name);
      }
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Add user'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving || !name || !email} onClick={save}>{user ? 'Save' : 'Add user'}</button></>}>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Full name" required error={errors.name} className="span-2"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" required error={errors.email}><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone" hint="Shown in offers they create."><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Role" className="span-2">
          <select className="select" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>
      {!user && <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>A temporary password will be generated. They’ll choose their own on first sign-in.</p>}
    </Modal>
  );
}
