import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ClipboardList, Search, User, UsersRound } from 'lucide-react';
import { api } from '../api';
import { StatusBadge, useDebounced, Spinner } from '../ui';
import { formatMoneyShort } from '../../../shared/format';

interface Results {
  owners: any[];
  units: any[];
  requirements: any[];
  users: any[];
}

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q.trim(), 180);
  const navigate = useNavigate();

  // "/" or Ctrl/Cmd+K focuses search from anywhere
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get<Results>(`/api/search?q=${encodeURIComponent(debounced)}`)
      .then((r) => {
        if (alive) {
          setResults(r);
          setHl(0);
        }
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced]);

  const flat = useMemo(() => {
    if (!results) return [] as { key: string; href: string }[];
    return [
      ...results.owners.map((o) => ({ key: `o${o.id}`, href: `/owners/${o.id}` })),
      ...results.units.map((u) => ({ key: `u${u.id}`, href: `/inventory/${u.id}` })),
      ...results.requirements.map((r) => ({ key: `r${r.id}`, href: `/requirements/${r.id}` })),
      ...(results.units.length ? [{ key: 'all', href: `/inventory?q=${encodeURIComponent(q.trim())}` }] : []),
    ];
  }, [results, q]);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    setResults(null);
    inputRef.current?.blur();
    navigate(href);
  };
  const idx = (key: string) => flat.findIndex((f) => f.key === key);
  const cls = (key: string) => `result ${flat[hl]?.key === key ? 'hl' : ''}`;
  const empty = results && !results.owners.length && !results.units.length && !results.requirements.length && !results.users.length;

  return (
    <div className="search-box">
      <Search size={16} style={{ position: 'absolute', left: 11, top: 9, color: 'var(--text-3)' }} />
      <input
        ref={inputRef}
        className="input"
        placeholder="Search owners, phones, projects, units…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHl((h) => Math.min(flat.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHl((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter' && flat[hl]) {
            go(flat[hl].href);
          } else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        aria-label="Universal search"
      />
      {!q && <kbd className="desktop-only">/</kbd>}
      {loading && <span style={{ position: 'absolute', right: 10, top: 9 }}><Spinner /></span>}
      {open && q.trim().length >= 2 && results && (
        <div className="popover search-results">
          {empty && <div className="empty">No matches for “{q}”</div>}
          {results.owners.length > 0 && (
            <div className="result-group">
              <div className="menu-label">Owners</div>
              {results.owners.map((o) => (
                <a key={o.id} className={cls(`o${o.id}`)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/owners/${o.id}`)} onMouseEnter={() => setHl(idx(`o${o.id}`))}>
                  <span className="icon-box"><UsersRound size={15} /></span>
                  <div className="grow">
                    <div className="title">{o.name}</div>
                    <div className="meta">
                      {o.primary_phone ? `Phone: ${o.primary_phone} · ` : ''}Properties owned: {o.unit_count}
                    </div>
                  </div>
                  {o.status !== 'Active' && <StatusBadge status={o.status} />}
                </a>
              ))}
            </div>
          )}
          {results.units.length > 0 && (
            <div className="result-group">
              <div className="menu-label">Inventory</div>
              {results.units.map((u) => (
                <a key={u.id} className={cls(`u${u.id}`)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/inventory/${u.id}`)} onMouseEnter={() => setHl(idx(`u${u.id}`))}>
                  <span className="icon-box"><Building2 size={15} /></span>
                  <div className="grow">
                    <div className="title">
                      {[u.project, u.unit_number].filter(Boolean).join(' ') || u.code} <span className="muted mono">{u.code}</span>
                    </div>
                    <div className="meta">
                      {[u.property_type, u.phase, u.bua ? `${u.bua} sqm` : null, u.asking_price ? formatMoneyShort(u.asking_price) : null, u.owner_name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <StatusBadge status={u.status} />
                </a>
              ))}
              <a className={cls('all')} onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/inventory?q=${encodeURIComponent(q.trim())}`)}>
                <span className="icon-box"><Search size={15} /></span>
                <div className="grow title">See all inventory matching “{q.trim()}”</div>
              </a>
            </div>
          )}
          {results.requirements.length > 0 && (
            <div className="result-group">
              <div className="menu-label">Requirements</div>
              {results.requirements.map((r) => (
                <a key={r.id} className={cls(`r${r.id}`)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/requirements/${r.id}`)} onMouseEnter={() => setHl(idx(`r${r.id}`))}>
                  <span className="icon-box"><ClipboardList size={15} /></span>
                  <div className="grow">
                    <div className="title">{r.client_name}</div>
                    <div className="meta">
                      {r.code}
                      {r.max_price ? ` · up to ${formatMoneyShort(r.max_price)}` : ''}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </a>
              ))}
            </div>
          )}
          {results.users.length > 0 && (
            <div className="result-group">
              <div className="menu-label">Agents</div>
              {results.users.map((u) => (
                <a key={u.id} className="result" onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/inventory?agent=${u.id}`)}>
                  <span className="icon-box"><User size={15} /></span>
                  <div className="grow">
                    <div className="title">{u.name}</div>
                    <div className="meta">View their listings</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
