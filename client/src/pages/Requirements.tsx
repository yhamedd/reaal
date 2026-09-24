import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Search } from 'lucide-react';
import { api, download, qs } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Empty, Loading, MultiSelect, StatusBadge, Switch, errorMessage, timeAgo, useDebounced, useToast } from '../ui';
import { useQuickCreate } from '../layout/QuickCreate';
import { formatMoneyShort } from '../../../shared/format';

export function describeBudget(r: { min_price: number | null; max_price: number | null }) {
  if (r.min_price && r.max_price) return `${formatMoneyShort(r.min_price)} – ${formatMoneyShort(r.max_price)}`;
  if (r.max_price) return `up to ${formatMoneyShort(r.max_price)}`;
  if (r.min_price) return `${formatMoneyShort(r.min_price)}+`;
  return 'Any budget';
}

export function RequirementsPage() {
  const { can } = useAuth();
  const { master } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const quick = useQuickCreate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const [status, setStatus] = useState<string[]>(params.get('status')?.split(',') ?? ['Active', 'Contacted']);
  const [priority, setPriority] = useState<string[]>([]);
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    api
      .get(`/api/requirements${qs({ q: debounced, status: status.join(','), priority: priority.join(','), mine: mine ? 1 : undefined })}`)
      .then(setRows)
      .catch((e) => toast(errorMessage(e), 'error'));
  }, [debounced, status, priority, mine, toast]);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Requirements</h1>
          <div className="sub">Buyer requests matched against available inventory.</div>
        </div>
        <div className="row">
          {can('requirements.export') && <button className="btn" onClick={() => download('/api/export/requirements?format=xlsx').catch((e) => toast(errorMessage(e), 'error'))}><Download size={15} /> Export</button>}
          {can('requirements.manage') && <button className="btn primary" onClick={() => quick('requirement')}><Plus size={15} /> Add Requirement</button>}
        </div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="input-affix" style={{ flex: '1 1 240px', maxWidth: 340 }}>
          <Search size={15} />
          <input className="input" placeholder="Search client, phone, agent…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ width: 190 }}><MultiSelect options={(master?.statuses.requirement ?? []).map((s) => ({ value: s, label: s }))} value={status} onChange={setStatus} placeholder="Any status" /></div>
        <div style={{ width: 160 }}><MultiSelect options={(master?.priorities ?? []).map((s) => ({ value: s, label: s }))} value={priority} onChange={setPriority} placeholder="Any priority" /></div>
        <Switch checked={mine} onChange={setMine} label="Mine only" />
      </div>
      <div className="panel">
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No requirements">{can('requirements.manage') && <button className="btn sm primary" onClick={() => quick('requirement')}>Add requirement</button>}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Client</th><th>Looking for</th><th>Budget</th><th>Priority</th><th>Status</th><th className="right">Matches</th><th>Agent</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/requirements/${r.id}`)}>
                    <td><strong>{r.client_name}</strong><div className="muted mono" style={{ fontSize: 11 }}>{r.code}</div></td>
                    <td>
                      {[r.property_types.join(' / '), r.preferred_projects.map((p: any) => p.name).join(', ') || r.developer, r.min_bedrooms ? `${r.min_bedrooms}+ BR` : null, r.min_bua ? `${r.min_bua}+ sqm` : null].filter(Boolean).join(' · ') || <span className="muted">Anything</span>}
                    </td>
                    <td className="nowrap">{describeBudget(r)}</td>
                    <td><StatusBadge status={r.priority} /></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="right num">{r.match_count ?? '—'}</td>
                    <td>{r.agent_name}</td>
                    <td className="muted nowrap">{timeAgo(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
