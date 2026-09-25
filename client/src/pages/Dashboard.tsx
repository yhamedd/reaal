import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, Loading, errorMessage, useToast } from '../ui';
import { ActivityItem, type ActivityRow } from '../components/RecordPanels';
import { useQuickCreate } from '../layout/QuickCreate';
import { daysSince } from '../../../shared/format';

interface DashboardData {
  kpis: Record<string, number | null>;
  activity: ActivityRow[];
  team_wide: boolean;
  my_units_to_verify: { id: number; project: string; unit_number: string; last_verified: string | null; status: string }[];
  available_by_project: { id: number; name: string; n: number }[];
}

const f = (filters: object) => `/inventory?filters=${encodeURIComponent(JSON.stringify(filters))}`;

export function DashboardPage() {
  const { me, can } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const quick = useQuickCreate();
  const navigate = useNavigate();
  const toast = useToast();
  const load = () => api.get<DashboardData>('/api/dashboard').then(setData).catch((e) => toast(errorMessage(e), 'error'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return <Loading />;
  const k = data.kpis;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const cards = [
    { key: 'total_units', label: 'Total Units', to: '/inventory' },
    { key: 'available_units', label: 'Available Units', to: f({ status: ['Available'] }), color: 'var(--ok)' },
    { key: 'reserved_units', label: 'Reserved Units', to: f({ status: ['Reserved'] }), color: 'var(--warn)' },
    { key: 'sold_units', label: 'Sold Units', to: f({ status: ['Sold'] }), color: 'var(--info)' },
    { key: 'total_owners', label: 'Total Owners', to: '/owners' },
    { key: 'active_requirements', label: 'Active Requests', to: '/requests?status=Active,Contacted' },
    { key: 'offers_created', label: 'Offers Created', to: '/offers' },
    { key: 'units_this_week', label: 'Units Added This Week', to: f({ created_from: weekAgo }) },
  ].filter((c) => k[c.key] !== null && k[c.key] !== undefined);

  const maxProject = Math.max(1, ...data.available_by_project.map((p) => p.n));
  const verify = async () => {
    const ids = data.my_units_to_verify.map((u) => u.id);
    await api.post('/api/units/verify', { ids });
    toast(`${ids.length} units marked as verified today`);
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {me!.name.split(' ')[0]}</h1>
          <div className="sub">Here’s what’s happening across the inventory.</div>
        </div>
        <div className="quick-actions">
          {can('inventory.create') && <button className="btn primary" onClick={() => quick('unit')}><Plus size={15} /> Add Unit</button>}
          {can('owners.create') && <button className="btn" onClick={() => quick('owner')}><Plus size={15} /> Add Owner</button>}
          {can('requirements.manage') && <button className="btn" onClick={() => quick('requirement')}><Plus size={15} /> Add Request</button>}
          {can('offers.create') && <button className="btn" onClick={() => navigate('/offers/new')}><FileText size={15} /> Create Offer</button>}
          {can('imports.run') && <button className="btn" onClick={() => navigate('/imports')}><FileSpreadsheet size={15} /> Import Excel</button>}
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        {cards.map((c) => (
          <Link key={c.key} className="kpi" to={c.to}>
            <div className="k">
              {c.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />}
              {c.label}
            </div>
            <div className="v">{(k[c.key] ?? 0).toLocaleString()}</div>
          </Link>
        ))}
      </div>

      <div className="layout-side">
        <div className="panel">
          <div className="panel-head">
            <h2>{data.team_wide ? 'Recent team activity' : 'Your recent activity'}</h2>
            <Link to="/activity" className="btn ghost sm">View all</Link>
          </div>
          {data.activity.length ? (
            <div className="feed">{data.activity.map((a) => <ActivityItem key={a.id} a={a} />)}</div>
          ) : (
            <Empty title="No activity yet" />
          )}
        </div>
        <div className="stack">
          {k.needs_verification !== null && (
            <div className="panel">
              <div className="panel-head">
                <h2 className="row"><AlertTriangle size={15} color="var(--warn)" /> Needs verification</h2>
                <Link className="btn ghost sm" to={f({ verification: ['attention', 'outdated', 'never'], status: ['Available', 'Reserved', 'Pending Verification'] })}>{k.needs_verification} units</Link>
              </div>
              <div className="panel-body flush">
                {data.my_units_to_verify.length === 0 ? (
                  <div className="empty" style={{ padding: 20 }}><CheckCircle2 size={22} color="var(--ok)" /><div>Your listings are up to date.</div></div>
                ) : (
                  <>
                    {data.my_units_to_verify.map((u) => {
                      const days = daysSince(u.last_verified);
                      return (
                        <Link key={u.id} to={`/inventory/${u.id}`} className="row between" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
                          <span>{u.project} {u.unit_number}</span>
                          <span className={`fresh ${days === null ? 'never' : days >= me!.config.verification.outdated ? 'outdated' : 'attention'}`} style={{ fontSize: 12 }}>
                            {days === null ? 'Never verified' : `${days} days`}
                          </span>
                        </Link>
                      );
                    })}
                    <div style={{ padding: 10 }}>
                      <button className="btn sm" onClick={verify}><CheckCircle2 size={14} /> Mark these as verified today</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {data.available_by_project.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Available by project</h2></div>
              <div className="panel-body stack tight">
                {data.available_by_project.map((p) => (
                  <Link key={p.id} to={f({ project_ids: [p.id], status: ['Available'] })} style={{ color: 'var(--text)', textDecoration: 'none' }}>
                    <div className="row between" style={{ fontSize: 12.5 }}><span>{p.name}</span><span className="num muted">{p.n}</span></div>
                    <div style={{ background: 'var(--gray-soft)', borderRadius: 3, marginTop: 3 }}><div className="bar" style={{ width: `${(p.n / maxProject) * 100}%` }} /></div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
