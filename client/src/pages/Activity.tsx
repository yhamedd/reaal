import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Avatar, Empty, Loading, MultiSelect, dateTime, errorMessage, useDebounced, useToast } from '../ui';
import { entityLink, type ActivityRow } from '../components/RecordPanels';

const ENTITY_TYPES = [
  { value: '', label: 'All records' },
  { value: 'unit', label: 'Units' },
  { value: 'owner', label: 'Owners' },
  { value: 'requirement', label: 'Requests' },
  { value: 'offer', label: 'Offers' },
  { value: 'inventory', label: 'Exports' },
  { value: 'user', label: 'Users' },
  { value: 'import', label: 'Imports' },
  { value: 'settings', label: 'Settings' },
];

export function ActivityPage() {
  const { can } = useAuth();
  const { users } = useData();
  const toast = useToast();
  const teamWide = can('activity.view');
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const [userIds, setUserIds] = useState<number[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [actionList, setActionList] = useState<string[]>([]);
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{ total: number; rows: ActivityRow[] } | null>(null);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    api.get<string[]>('/api/activity/actions').then(setActionList).catch(() => undefined);
  }, []);
  useEffect(() => {
    api
      .get(`/api/activity${qs({ q: debounced, user_ids: userIds.join(','), actions: actions.join(','), entity_type: entityType, from, to, limit, mine: teamWide ? undefined : 1 })}`)
      .then(setData)
      .catch((e) => toast(errorMessage(e), 'error'));
  }, [debounced, userIds, actions, entityType, from, to, limit, teamWide, toast]);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <div className="sub">{teamWide ? 'Every important action across the team.' : 'Your recent actions.'}</div>
        </div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="input-affix" style={{ flex: '1 1 240px', maxWidth: 340 }}>
          <Search size={15} />
          <input className="input" placeholder="Search actions, records, values…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {teamWide && <div style={{ width: 170 }}><MultiSelect options={users.map((u) => ({ value: u.id, label: u.name }))} value={userIds} onChange={setUserIds} placeholder="Any user" /></div>}
        <div style={{ width: 170 }}><MultiSelect options={actionList.map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))} value={actions} onChange={setActions} placeholder="Any action" /></div>
        <select className="select" style={{ width: 150 }} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input className="input" type="date" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" type="date" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      <div className="panel">
        {!data ? <Loading /> : data.rows.length === 0 ? <Empty title="No activity found" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Previous value</th><th>New value</th></tr></thead>
              <tbody>
                {data.rows.map((a) => {
                  const link = entityLink(a);
                  return (
                    <tr key={a.id}>
                      <td className="nowrap muted">{dateTime(a.created_at)}</td>
                      <td className="nowrap"><span className="row"><Avatar name={a.user_name} /> {a.user_name ?? 'System'}</span></td>
                      <td>{a.message}</td>
                      <td className="nowrap">{a.entity_label ? (link ? <Link to={link}>{a.entity_label}</Link> : a.entity_label) : '—'}</td>
                      <td className="change"><span className="old">{a.old_value}</span></td>
                      <td className="change"><span className="new">{a.new_value}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && data.total > data.rows.length && (
        <div style={{ textAlign: 'center', marginTop: 12 }}><button className="btn" onClick={() => setLimit((l) => l + 100)}>Load more</button></div>
      )}
    </div>
  );
}
