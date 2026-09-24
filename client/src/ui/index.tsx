import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Inbox, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}
const ToastContext = createContext<(message: string, kind?: 'info' | 'error') => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            <span className="grow">{t.message}</span>
            <button className="btn ghost sm icon" style={{ color: 'inherit' }} onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

// ---------------------------------------------------------------------------
// Modal / Drawer
// ---------------------------------------------------------------------------

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg' | 'xl';
}) {
  useEscape(onClose);
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose);
  return createPortal(
    <>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (promise based)
// ---------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  typeToConfirm?: string;
}
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setState({ ...o, resolve });
      }),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                className={`btn ${state.danger ? 'danger solid' : 'primary'}`}
                disabled={!!state.typeToConfirm && typed !== state.typeToConfirm}
                onClick={() => close(true)}
                autoFocus={!state.typeToConfirm}
              >
                {state.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <div className="stack">
            {state.message && <div className="text-2">{state.message}</div>}
            {state.typeToConfirm && (
              <div className="field">
                <label>
                  Type <strong className="mono">{state.typeToConfirm}</strong> to confirm
                </label>
                <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
            )}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------------------------------------------------------------------------
// Popover anchored to an element
// ---------------------------------------------------------------------------

export function Popover({
  anchor,
  onClose,
  children,
  align = 'left',
  width,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = a.bottom + 4;
      if (top + h > window.innerHeight - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
      setPos({ top: top + window.scrollY, left: left + window.scrollX });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="popover" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

/** Button that toggles a dropdown menu. */
export function Dropdown({
  label,
  children,
  className = 'btn',
  align = 'left',
  width,
  title,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
  width?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={ref} type="button" className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={title}>
        {label}
      </button>
      {open && (
        <Popover anchor={ref} onClose={close} align={align} width={width}>
          {children(close)}
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Multi select (checkbox list in a popover)
// ---------------------------------------------------------------------------

export function MultiSelect<T extends string | number>({
  options,
  value,
  onChange,
  placeholder = 'Any',
  label,
  searchable,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  placeholder?: string;
  label?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const selected = options.filter((o) => value.includes(o.value));
  const text = selected.length === 0 ? placeholder : selected.length <= 2 ? selected.map((s) => s.label).join(', ') : `${selected.length} selected`;
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <>
      <button ref={ref} type="button" className="select" style={{ textAlign: 'left' }} onClick={() => setOpen((o) => !o)} aria-label={label}>
        <span className={`truncate ${selected.length ? '' : 'muted'}`} style={{ display: 'block' }}>
          {text}
        </span>
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} width={Math.max(220, ref.current?.offsetWidth ?? 0)}>
          {(searchable || options.length > 10) && (
            <div style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
              <input className="input sm" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="menu">
            {shown.map((o) => {
              const on = value.includes(o.value);
              return (
                <button key={String(o.value)} type="button" onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
                  <span style={{ width: 16, display: 'inline-flex' }}>{on && <Check size={14} />}</span>
                  {o.label}
                </button>
              );
            })}
            {!shown.length && <div className="muted" style={{ padding: 8 }}>No options</div>}
          </div>
          {value.length > 0 && (
            <div style={{ padding: 6, borderTop: '1px solid var(--border)' }}>
              <button className="btn sm ghost" type="button" onClick={() => onChange([])}>
                Clear
              </button>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Combobox: type-to-search single select with optional "create" action
// ---------------------------------------------------------------------------

export function Combobox<T>({
  value,
  display,
  search,
  renderItem,
  onSelect,
  placeholder,
  onCreate,
  createLabel,
  invalid,
  autoFocus,
}: {
  value: T | null;
  display: (v: T) => string;
  search: (q: string) => Promise<T[]> | T[];
  renderItem: (v: T) => ReactNode;
  onSelect: (v: T | null) => void;
  placeholder?: string;
  onCreate?: (q: string) => void;
  createLabel?: (q: string) => string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const r = await search(q);
      if (id === seq.current) {
        setItems(r);
        setHl(0);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, open, search]);
  if (value && !open) {
    return (
      <div className="input row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => { setOpen(true); setQ(''); setTimeout(() => inputRef.current?.focus()); }}>
        <span className="truncate">{display(value)}</span>
        <button type="button" className="btn ghost sm icon" onClick={(e) => { e.stopPropagation(); onSelect(null); }} aria-label="Clear">
          <X size={14} />
        </button>
      </div>
    );
  }
  const total = items.length + (onCreate && q.trim() ? 1 : 0);
  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className={`input ${invalid ? 'invalid' : ''}`}
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(total - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (hl < items.length && items[hl]) { onSelect(items[hl]); setOpen(false); }
            else if (onCreate && q.trim()) { onCreate(q.trim()); setOpen(false); }
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (items.length > 0 || (onCreate && q.trim())) && (
        <div className="popover menu" style={{ top: 'calc(100% + 4px)', left: 0, right: 0 }}>
          {items.map((it, i) => (
            <button key={i} type="button" className={i === hl ? 'hl' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(it); setOpen(false); }}>
              {renderItem(it)}
            </button>
          ))}
          {onCreate && q.trim() && (
            <button type="button" className={hl === items.length ? 'hl' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(q.trim()); setOpen(false); }} style={{ color: 'var(--accent)' }}>
              {createLabel ? createLabel(q.trim()) : `Create “${q.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  Available: 'green',
  Reserved: 'yellow',
  Sold: 'blue',
  'Off Market': 'gray',
  'Pending Verification': 'purple',
  Archived: 'gray',
  Active: 'green',
  Inactive: 'gray',
  'Do Not Contact': 'red',
  Contacted: 'blue',
  Matched: 'purple',
  Closed: 'gray',
  Urgent: 'red',
  High: 'orange',
  Medium: 'blue',
  Low: 'gray',
  active: 'green',
  disabled: 'red',
  completed: 'green',
  validated: 'blue',
  uploaded: 'gray',
};

export function StatusBadge({ status, large }: { status: string | null | undefined; large?: boolean }) {
  if (!status) return null;
  return (
    <span className={`badge ${STATUS_COLORS[status] ?? 'gray'} ${large ? 'lg' : ''}`}>
      <span className="dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function TagChip({ tag, onRemove }: { tag: { name: string; color: string }; onRemove?: () => void }) {
  return (
    <span className="tag" data-color={tag.color}>
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${tag.name}`}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

export function Field({ label, error, hint, required, children, className }: { label: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label className={required ? 'req' : ''}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="checkbox">
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label}
    </label>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="loading-block">
      <Spinner />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={28} />}
      <div style={{ fontWeight: 550, color: 'var(--text-2)' }}>{title}</div>
      {children && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function Avatar({ name, large }: { name: string | null | undefined; large?: boolean }) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
  return <span className={`avatar ${large ? 'lg' : ''}`}>{initials || '?'}</span>;
}

export function SelectChevron() {
  return <ChevronDown size={14} />;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function parseServerDate(v: string): Date {
  // Server timestamps are UTC "YYYY-MM-DD HH:MM:SS"; plain dates are local calendar days.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00');
  return new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
}

export function timeAgo(v: string | null | undefined): string {
  if (!v) return '';
  const d = parseServerDate(v);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '';
  return parseServerDate(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
