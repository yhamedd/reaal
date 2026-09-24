import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useData, type Tag } from '../data';
import { useAuth } from '../auth';
import { Modal, Popover, TagChip } from '../ui';
import { formatMoney, parseLooseNumber } from '../../../shared/format';

export function TagPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { master } = useData();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const tags = master?.tags ?? [];
  const selected = tags.filter((t) => value.includes(t.id));
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {selected.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((v) => v !== t.id))} />
      ))}
      <button ref={ref} type="button" className="btn sm ghost" onClick={() => setOpen(true)}>
        <Plus size={13} /> Tag
      </button>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)}>
          <div className="menu">
            {tags.filter((t) => !value.includes(t.id)).map((t: Tag) => (
              <button key={t.id} type="button" onClick={() => { onChange([...value, t.id]); setOpen(false); }}>
                <TagChip tag={t} />
              </button>
            ))}
            {tags.length === value.length && <div className="muted" style={{ padding: 8 }}>No more tags</div>}
          </div>
        </Popover>
      )}
    </div>
  );
}

/** Text input that accepts "42M", "3.5m", "750k", "42,000,000" and shows the parsed amount. */
export function MoneyInput({ value, onChange, invalid, placeholder }: { value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string }) {
  const { me } = useAuth();
  const parsed = parseLooseNumber(value);
  return (
    <>
      <input className={`input num ${invalid || (parsed !== undefined && Number.isNaN(parsed)) ? 'invalid' : ''}`} inputMode="decimal" value={value} placeholder={placeholder ?? 'e.g. 42M'} onChange={(e) => onChange(e.target.value)} />
      {parsed !== undefined && !Number.isNaN(parsed) && /[a-z]/i.test(value) && <span className="hint">= {formatMoney(parsed, me?.config.currency)}</span>}
    </>
  );
}

export function numToInput(v: number | null | undefined) {
  return v === null || v === undefined ? '' : String(v);
}

export function AgentSelect({ value, onChange, allowEmpty = true }: { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean }) {
  const { users } = useData();
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowEmpty && <option value="">Unassigned</option>}
      {users
        .filter((u) => u.status === 'active' || u.id === value)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
    </select>
  );
}

export function ValueSelect({ category, value, onChange, placeholder = '—' }: { category: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { values } = useData();
  const options = values(category);
  const known = !value || options.some((o) => o.toLowerCase() === value.toLowerCase());
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {!known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export interface DuplicateInfo {
  duplicates?: any[];
  owner_duplicates?: any[];
}

/** "Possible duplicate found" — View Existing / Cancel / Create Anyway. */
export function DuplicateDialog({ info, onCancel, onCreateAnyway, kind }: { info: DuplicateInfo; onCancel: () => void; onCreateAnyway: () => void; kind: 'unit' | 'owner' }) {
  const units = kind === 'unit' ? info.duplicates ?? [] : [];
  const owners = kind === 'owner' ? info.duplicates ?? [] : info.owner_duplicates ?? [];
  return (
    <Modal
      title="Possible duplicate found"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={onCreateAnyway}>Create Anyway</button>
        </>
      }
    >
      <div className="stack">
        <p className="text-2">A record that looks the same already exists. Check it before creating another one — creating a duplicate will be logged.</p>
        {units.map((u) => (
          <div key={u.id} className="unit-pill">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{[u.project, u.unit_number].filter(Boolean).join(' | ')} <span className="muted mono">{u.code}</span></div>
              <div className="muted" style={{ fontSize: 12 }}>{[u.phase, u.property_type, u.owner_name, u.status].filter(Boolean).join(' · ')}</div>
            </div>
            <Link className="btn sm" to={`/inventory/${u.id}`} target="_blank">View Existing</Link>
          </div>
        ))}
        {owners.map((o) => (
          <div key={o.id} className="unit-pill">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{[o.primary_phone, (o.reasons ?? []).join(', '), `${o.unit_count ?? 0} units`].filter(Boolean).join(' · ')}</div>
            </div>
            <Link className="btn sm" to={`/owners/${o.id}`} target="_blank">View Existing</Link>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function useSessionDraft<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, () => void, boolean] {
  const [restored] = useState(() => {
    try {
      return sessionStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };
  const clear = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return [value, set, clear, restored];
}
