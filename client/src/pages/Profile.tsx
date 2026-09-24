import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Field, errorMessage, useToast } from '../ui';
import { ChangePasswordForm } from './Auth';

export function ProfilePage() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me!.name);
  const [phone, setPhone] = useState(me!.phone ?? '');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('reaal.theme') ?? 'system';
    } catch {
      return 'system';
    }
  });
  const save = async () => {
    try {
      await api.patch('/api/users/me/profile', { name, phone });
      await refresh();
      toast('Profile updated');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const applyTheme = (t: string) => {
    setTheme(t);
    try {
      localStorage.setItem('reaal.theme', t);
    } catch {
      /* ignore */
    }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><h1>Profile</h1></div>
      <div className="stack loose">
        <div className="panel">
          <div className="panel-head"><h2>Your details</h2></div>
          <div className="panel-body stack">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Phone" hint="Used as the contact number on offers you create."><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <Field label="Email"><input className="input" value={me!.email} disabled /></Field>
              <Field label="Role"><input className="input" value={me!.role_name} disabled /></Field>
            </div>
            <div><button className="btn primary" onClick={save}>Save</button></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Appearance</h2></div>
          <div className="panel-body">
            <div className="btn-group">
              {['system', 'light', 'dark'].map((t) => (
                <button key={t} className={`btn ${theme === t ? 'active' : ''}`} onClick={() => applyTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Change password</h2></div>
          <div className="panel-body"><ChangePasswordForm onDone={() => toast('Password changed. Other sessions were signed out.')} /></div>
        </div>
      </div>
    </div>
  );
}
