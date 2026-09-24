import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Plus, Search } from 'lucide-react';
import { api, download, qs } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Dropdown, Empty, Loading, MultiSelect, StatusBadge, TagChip, errorMessage, timeAgo, useDebounced, useToast } from '../ui';
import { useQuickCreate } from '../layout/QuickCreate';

export function OwnersPage() {
  const { can } = useAuth();
  const { master, users } = useData();
  const navigate = useNavigate();
  const quick = useQuickCreate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const [status, setStatus] = useState<string[]>([]);
  const [agents, setAgents] = useState<number[]>([]);
  const [tags, setTags] = useState<number[]>([]);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'updated_at', dir: 'desc' });
  const [data, setData] = useState<{ total: number; rows: any[] } | null>(null);
  const [limit, setLimit] = useState(200);

  useEffect(() => {
    let alive = true;
    api
      .get(`/api/owners${qs({ q: debounced, status: status.join(','), assigned: agents.join(','), tags: tags.join(','), sort: sort.key, dir: sort.dir, limit })}`)
      .then((r) => alive && setData(r))
      .catch((e) => toast(errorMessage(e), 'error'));
    return () => {
      alive = false;
    };
  }, [debounced, status, agents, tags, sort, limit, toast]);

  const th = (key: string, label: string, right = false) => (
    <th className={`sortable ${right ? 'right' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label} {sort.key === key && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </th>
  );

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Owners</h1>
          <div className="sub">{data ? `${data.total.toLocaleString()} owners` : ' '}</div>
        </div>
        <div className="row">
          {can('owners.export') && (
            <Dropdown className="btn" label={<><Download size={15} /> Export</>} align="right">
              {(close) => (
                <div className="menu">
                  <button onClick={() => { close(); download(`/api/export/owners?format=xlsx`).catch((e) => toast(errorMessage(e), 'error')); }}>Owner database (Excel)</button>
                  <button onClick={() => { close(); download(`/api/export/owners?format=csv`).catch((e) => toast(errorMessage(e), 'error')); }}>Owner database (CSV)</button>
                </div>
              )}
            </Dropdown>
          )}
          {can('owners.create') && <button className="btn primary" onClick={() => quick('owner')}><Plus size={15} /> Add Owner</button>}
        </div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="input-affix" style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <Search size={15} />
          <input className="input" autoFocus placeholder="Search by name, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ width: 170 }}><MultiSelect options={(master?.statuses.owner ?? []).map((s) => ({ value: s, label: s }))} value={status} onChange={setStatus} placeholder="Any status" /></div>
        <div style={{ width: 170 }}><MultiSelect options={users.map((u) => ({ value: u.id, label: u.name }))} value={agents} onChange={setAgents} placeholder="Any agent" /></div>
        <div style={{ width: 170 }}><MultiSelect options={(master?.tags ?? []).map((t) => ({ value: t.id, label: t.name }))} value={tags} onChange={setTags} placeholder="Any tag" /></div>
      </div>
      <div className="panel">
        {!data ? (
          <Loading />
        ) : data.rows.length === 0 ? (
          <Empty title="No owners found">{can('owners.create') && <button className="btn sm primary" onClick={() => quick('owner')}>Add owner</button>}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  {th('name', 'Name')}
                  <th>Primary phone</th>
                  <th className="desktop-only">Email</th>
                  {th('unit_count', 'Units', true)}
                  {th('agent_name', 'Agent')}
                  <th className="desktop-only">Tags</th>
                  {th('status', 'Status')}
                  {th('last_contacted', 'Last contacted')}
                  {th('updated_at', 'Updated')}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/owners/${o.id}`)}>
                    <td className="mono muted">{o.code}</td>
                    <td><strong>{o.name}</strong></td>
                    <td className="nowrap">{o.primary_phone}</td>
                    <td className="desktop-only muted">{o.email}</td>
                    <td className="right num">{o.unit_count}</td>
                    <td>{o.agent_name}</td>
                    <td className="desktop-only"><span className="row" style={{ gap: 4 }}>{o.tags.map((t: any) => <TagChip key={t.id} tag={t} />)}</span></td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="muted nowrap">{timeAgo(o.last_contacted)}</td>
                    <td className="muted nowrap">{timeAgo(o.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && data.total > data.rows.length && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => setLimit((l) => l + 200)}>Show more ({(data.total - data.rows.length).toLocaleString()} remaining)</button>
        </div>
      )}
    </div>
  );
}
