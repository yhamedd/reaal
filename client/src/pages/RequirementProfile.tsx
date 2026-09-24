import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronRight, FileText, Pencil, Search, Undo2, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Drawer, Dropdown, Empty, Loading, StatusBadge, TagChip, errorMessage, timeAgo, useConfirm, useToast } from '../ui';
import { ActivityList, NotesPanel } from '../components/RecordPanels';
import { RequirementForm } from '../components/RequirementForm';
import { ContactButtons } from '../components/ContactButtons';
import { NotFound } from './Errors';
import { describeBudget } from './Requirements';
import { formatMoneyShort, formatNumber, verificationFreshness } from '../../../shared/format';

export function RequirementPage() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const { master } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [r, setR] = useState<any | null>(null);
  const [missing, setMissing] = useState(false);
  const [matches, setMatches] = useState<any[] | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api.get(`/api/requirements/${id}`).then(setR).catch(() => setMissing(true));
  }, [id]);
  const loadMatches = useCallback(() => {
    if (!can('inventory.view')) return setMatches([]);
    api.get(`/api/requirements/${id}/matches${showExcluded ? '?include_excluded=1' : ''}`).then(setMatches).catch(() => setMatches([]));
  }, [id, showExcluded, can]);
  useEffect(load, [load]);
  useEffect(loadMatches, [loadMatches]);

  if (missing) return <NotFound />;
  if (!r) return <Loading />;

  const exclude = async (unitIds: number[]) => {
    await api.post(`/api/requirements/${r.id}/exclusions`, { unit_ids: unitIds });
    setSelected((s) => new Set([...s].filter((x) => !unitIds.includes(x))));
    loadMatches();
    setTick((t) => t + 1);
  };
  const include = async (unitId: number) => {
    await api.delete(`/api/requirements/${r.id}/exclusions/${unitId}`);
    loadMatches();
  };
  const setStatus = async (status: string) => {
    try {
      await api.patch(`/api/requirements/${r.id}`, { status });
      load();
      setTick((t) => t + 1);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const archive = async () => {
    if (!(await confirm({ title: 'Archive requirement?', confirmLabel: 'Archive', danger: true }))) return;
    await api.post(`/api/requirements/${r.id}/archive`);
    navigate('/requirements');
  };

  const active = (matches ?? []).filter((m) => !m.excluded);
  const allSelected = active.length > 0 && active.every((m) => selected.has(m.id));
  const toggle = (uid: number) => setSelected((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const criteria = [
    r.preferred_projects.length ? `Projects: ${r.preferred_projects.map((p: any) => p.name).join(', ')}` : r.developer ? `Developer: ${r.developer}` : 'Any project',
    r.property_types.length ? `Type: ${r.property_types.join(', ')}` : 'Any type',
    `Budget: ${describeBudget(r)}`,
    r.min_bua || r.max_bua ? `BUA: ${r.min_bua ?? 0}${r.max_bua ? `–${r.max_bua}` : '+'} sqm` : null,
    r.min_bedrooms ? `Bedrooms: ${r.min_bedrooms}+` : null,
    'Status: Available',
  ].filter(Boolean);

  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/requirements">Requirements</Link> <ChevronRight size={12} /> <span className="mono">{r.code}</span></div>
      <div className="profile-head">
        <div className="stack tight">
          <div className="row wrap">
            <h1>{r.client_name}</h1>
            <StatusBadge status={r.status} />
            <StatusBadge status={r.priority} />
          </div>
          <div className="text-2">{r.agent_name ? `Agent: ${r.agent_name}` : 'Unassigned'} · Added {timeAgo(r.created_at)}{r.created_by_name ? ` by ${r.created_by_name}` : ''}</div>
          {r.tags.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{r.tags.map((t: any) => <TagChip key={t.id} tag={t} />)}</div>}
        </div>
        <div className="row wrap">
          <ContactButtons phone={r.phone} whatsapp={r.whatsapp} hidden={r.contact_hidden} />
          {can('requirements.manage') && (
            <Dropdown className="btn" label={<>Status <StatusBadge status={r.status} /></>} align="right">
              {(close) => (
                <div className="menu">
                  {(master?.statuses.requirement ?? []).map((s) => (
                    <button key={s} disabled={s === r.status} onClick={() => { close(); setStatus(s); }}><StatusBadge status={s} /></button>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
          {can('requirements.manage') && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>}
          {can('requirements.manage') && <button className="btn icon" onClick={archive} title="Archive"><Archive size={15} /></button>}
        </div>
      </div>

      <div className="layout-side">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2 className="row"><Search size={15} /> Matching units {matches && <span className="muted">({active.length})</span>}</h2>
              <div className="row">
                <label className="checkbox" style={{ fontSize: 12 }}><input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} /> Show removed</label>
                {can('offers.create') && (
                  <button className="btn primary sm" disabled={!selected.size} onClick={() => navigate(`/offers/new?units=${[...selected].join(',')}&requirement=${r.id}`)}>
                    <FileText size={14} /> Create Offer{selected.size ? ` (${selected.size})` : ''}
                  </button>
                )}
              </div>
            </div>
            <div className="panel-body" style={{ paddingTop: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <div className="row wrap" style={{ gap: 6 }}>{criteria.map((c) => <span key={c} className="badge gray">{c}</span>)}</div>
            </div>
            {!matches ? (
              <Loading />
            ) : matches.length === 0 ? (
              <Empty title="No suitable units right now">You’ll be notified when a matching unit is added.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(active.map((m) => m.id)))} aria-label="Select all matches" /></th>
                      <th>Unit</th>
                      <th>Type</th>
                      <th className="right">BUA</th>
                      <th className="right">Beds</th>
                      <th className="right">Asking</th>
                      <th>Why</th>
                      <th>Verified</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id} style={m.excluded ? { opacity: 0.5 } : undefined}>
                        <td>{!m.excluded && <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label="Select unit" />}</td>
                        <td>
                          <Link to={`/inventory/${m.id}`}><strong>{m.project} {m.unit_number}</strong></Link>
                          {m.already_offered && <span className="badge blue" style={{ marginLeft: 6 }}>Offered</span>}
                          <div className="muted" style={{ fontSize: 11.5 }}>{[m.phase, m.finishing, m.delivery].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td>{m.property_type}</td>
                        <td className="right num">{m.bua ? formatNumber(m.bua) : ''}</td>
                        <td className="right num">{m.bedrooms ?? ''}</td>
                        <td className="right num">{m.asking_price ? formatMoneyShort(m.asking_price) : ''}</td>
                        <td><span className="muted" style={{ fontSize: 12 }}>{m.reasons.join(', ') || '—'}</span></td>
                        <td><span className={`fresh ${verificationFreshness(m.last_verified, me!.config.verification)}`} style={{ fontSize: 12 }}>{m.last_verified ? timeAgo(m.last_verified) : 'Never'}</span></td>
                        <td className="right">
                          {can('requirements.manage') && (m.excluded
                            ? <button className="btn ghost sm" onClick={() => include(m.id)}><Undo2 size={13} /> Restore</button>
                            : <button className="btn ghost sm icon" onClick={() => exclude([m.id])} title="Remove from matches"><X size={14} /></button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selected.size > 0 && can('requirements.manage') && (
              <div className="panel-body row" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="grow">{selected.size} selected</span>
                <button className="btn sm" onClick={() => exclude([...selected])}><X size={13} /> Remove irrelevant</button>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Offers sent</h2></div>
            <div className="panel-body flush">
              {r.offers.length === 0 ? <div className="muted" style={{ padding: 14 }}>No offers yet.</div> : r.offers.map((o: any) => (
                <Link key={o.id} to={`/offers/${o.id}`} className="row between" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
                  <span>{o.unit_count} unit{o.unit_count === 1 ? '' : 's'} · {o.template}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{o.created_by_name} · {timeAgo(o.created_at)}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Activity</h2></div>
            <ActivityList entityType="requirement" entityId={r.id} reloadKey={tick} />
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h2>Requirement</h2></div>
            <div className="panel-body">
              <dl className="dl" style={{ margin: 0 }}>
                <dt>Phone</dt><dd>{r.phone ?? '—'}</dd>
                <dt>WhatsApp</dt><dd>{r.whatsapp ?? '—'}</dd>
                <dt>Developer</dt><dd>{r.developer ?? 'Any'}</dd>
                <dt>Projects</dt><dd>{r.preferred_projects.map((p: any) => p.name).join(', ') || 'Any'}</dd>
                <dt>Property type</dt><dd>{r.property_types.join(', ') || 'Any'}</dd>
                <dt>BUA</dt><dd>{r.min_bua || r.max_bua ? `${r.min_bua ?? 0} – ${r.max_bua ?? '∞'} sqm` : 'Any'}</dd>
                <dt>Bedrooms</dt><dd>{r.min_bedrooms ? `${r.min_bedrooms}+` : 'Any'}</dd>
                <dt>Budget</dt><dd>{describeBudget(r)}</dd>
                <dt>Finishing</dt><dd>{r.finishing ?? 'Any'}</dd>
                <dt>Delivery</dt><dd>{r.delivery_preference ?? 'Any'}</dd>
              </dl>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Notes</h2></div>
            <div className="panel-body"><NotesPanel entityType="requirement" entityId={r.id} onChange={() => setTick((t) => t + 1)} /></div>
          </div>
        </div>
      </div>
      {editing && (
        <Drawer title={`Edit requirement`} onClose={() => setEditing(false)} wide>
          <RequirementForm requirement={r} onSaved={() => { setEditing(false); load(); loadMatches(); setTick((t) => t + 1); }} onCancel={() => setEditing(false)} />
        </Drawer>
      )}
    </div>
  );
}
