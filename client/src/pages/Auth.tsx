import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Field, Spinner, errorMessage } from '../ui';

function useBranding() {
  const [b, setB] = useState<{ company_name: string; has_logo: boolean } | null>(null);
  useEffect(() => {
    api.get('/api/public/branding').then(setB).catch(() => setB({ company_name: 'Reaal', has_logo: false }));
  }, []);
  return b;
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const b = useBranding();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="brand-mark">{b?.has_logo ? <img src="/api/public/logo" alt="" /> : (b?.company_name ?? 'R').charAt(0)}</span>
          {b?.company_name}
        </div>
        <h1 style={{ fontSize: 18, marginBottom: 4 }}>{title}</h1>
        {subtitle && <p className="muted" style={{ marginBottom: 18 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { refresh, expiredReason } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('reaal.email') ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password, remember });
      try {
        localStorage.setItem('reaal.email', email);
      } catch {
        /* ignore */
      }
      await refresh();
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in" subtitle="Use your company account to continue.">
      {expiredReason && <div className="callout warn" style={{ marginBottom: 14 }}>{expiredReason}</div>}
      <form className="stack" onSubmit={submit}>
        <Field label="Email">
          <input className="input" type="email" autoComplete="username" autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" autoFocus={!!email} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="row between">
          <label className="checkbox">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me
          </label>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        {error && <div className="callout danger">{error}</div>}
        <button className="btn primary lg" disabled={busy || !email || !password}>{busy ? <Spinner /> : 'Sign in'}</button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post('/api/auth/forgot', { email });
      setMessage(r.message);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <AuthCard title="Forgot password" subtitle="Enter your email and an administrator will send you a secure reset link.">
      {message ? (
        <div className="stack">
          <div className="callout ok">{message}</div>
          <Link to="/login">Back to sign in</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Email">
            <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <div className="callout danger">{error}</div>}
          <button className="btn primary lg" disabled={!email}>Request reset</button>
          <Link to="/login">Back to sign in</Link>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { me, logout } = useAuth();
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    api.get(`/api/auth/reset/${encodeURIComponent(token)}`).then(setInfo).catch(() => setInvalid(true));
  }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    try {
      await api.post('/api/auth/reset', { token, password });
      if (me) await logout();
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  if (invalid) return <AuthCard title="Link expired" subtitle="This reset link is invalid or has already been used. Ask your administrator for a new one."><Link to="/login">Back to sign in</Link></AuthCard>;
  if (done) return <AuthCard title="Password updated" subtitle="You can now sign in with your new password."><Link className="btn primary" to="/login">Sign in</Link></AuthCard>;
  return (
    <AuthCard title="Set a new password" subtitle={info ? `For ${info.name} (${info.email})` : undefined}>
      <form className="stack" onSubmit={submit}>
        <Field label="New password" hint="At least 8 characters, with letters and numbers.">
          <input className="input" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password">
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <div className="callout danger">{error}</div>}
        <button className="btn primary lg" disabled={!password || !info}>Update password</button>
      </form>
    </AuthCard>
  );
}

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (next !== confirm) return setErrors({ confirm: 'Passwords do not match' });
    try {
      await api.post('/api/auth/change-password', { current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setError(errorMessage(err));
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Current password" error={errors.current_password}>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" error={errors.new_password} hint="At least 8 characters, with letters and numbers.">
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Confirm new password" error={errors.confirm}>
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && !Object.keys(errors).length && <div className="callout danger">{error}</div>}
      <div>
        <button className="btn primary" disabled={!current || !next}>Change password</button>
      </div>
    </form>
  );
}

export function ForceChangePassword() {
  const { refresh, logout } = useAuth();
  return (
    <AuthCard title="Choose a new password" subtitle="Your account is using a temporary password. Set your own to continue.">
      <ChangePasswordForm onDone={refresh} />
      <div style={{ marginTop: 14 }}>
        <button className="btn ghost sm" onClick={() => logout()}>Sign out</button>
      </div>
    </AuthCard>
  );
}
