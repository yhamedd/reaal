import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Copy, FileText, Plus, Search } from 'lucide-react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, Loading, StatusBadge, Switch, copyText, dateTime, errorMessage, timeAgo, useDebounced, useToast } from '../ui';
import { NotFound } from './Errors';
import { formatMoneyShort } from '../../../shared/format';

const TEMPLATE_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', short: 'Short', detailed: 'Detailed', pdf: 'PDF', internal: 'Internal' };

export function OffersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const [mine, setMine] = useState(!can('offers.view_all'));
  const [template, setTemplate] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api.get(`/api/offers${qs({ q: debounced, mine: mine ? 1 : undefined, template })}`).then(setRows).catch((e) => toast(errorMessage(e), 'error'));
  }, [debounced, mine, template, toast]);
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Offers</h1>
          <div className="sub">A record of which inventory was offered, to whom and by whom.</div>
        </div>
        <button className="btn primary" onClick={() => navigate('/offers/new')}><Plus size={15} /> Create Offer</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="input-affix" style={{ flex: '1 1 240px', maxWidth: 340 }}>
          <Search size={15} />
          <input className="input" placeholder="Search client or content…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 160 }} value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">All templates</option>
          {Object.entries(TEMPLATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {can('offers.view_all') && <Switch checked={mine} onChange={setMine} label="Mine only" />}
      </div>
      <div className="panel">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty icon={<FileText size={28} />} title="No offers yet"><button className="btn sm primary" onClick={() => navigate('/offers/new')}>Create an offer</button></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Offer</th><th>Client</th><th>Units</th><th>Template</th><th>Created by</th><th>Date</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => navigate(`/offers/${o.id}`)}>
                    <td className="mono">{o.code}</td>
                    <td>{o.client_name ?? o.requirement_client ?? <span className="muted">—</span>}</td>
                    <td><span className="truncate" style={{ display: 'inline-block', maxWidth: 320 }}>{o.unit_labels}</span> {o.unit_count > 1 && <span className="muted">({o.unit_count})</span>}</td>
                    <td><span className="badge gray">{TEMPLATE_LABELS[o.template] ?? o.template}</span></td>
                    <td>{o.created_by_name}</td>
                    <td className="muted nowrap" title={dateTime(o.created_at)}>{timeAgo(o.created_at)}</td>
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

export function OfferDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [offer, setOffer] = useState<any | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.get(`/api/offers/${id}`).then(setOffer).catch(() => setMissing(true));
  }, [id]);
  if (missing) return <NotFound />;
  if (!offer) return <Loading />;
  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/offers">Offers</Link> <ChevronRight size={12} /> <span className="mono">{offer.code}</span></div>
      <div className="profile-head">
        <div>
          <h1>Offer {offer.code}</h1>
          <div className="text-2">
            {TEMPLATE_LABELS[offer.template] ?? offer.template} · {offer.created_by_name} · {dateTime(offer.created_at)}
            {offer.client_name && <> · for <strong>{offer.client_name}</strong></>}
            {offer.requirement_id && <> · <Link to={`/requests/${offer.requirement_id}`}>View requirement</Link></>}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => copyText(offer.content).then(() => toast('Offer copied'))}><Copy size={15} /> Copy</button>
          <button className="btn primary" onClick={() => navigate(`/offers/new?units=${offer.units.map((u: any) => u.id).join(',')}${offer.requirement_id ? `&requirement=${offer.requirement_id}` : ''}`)}>Create new offer from these units</button>
        </div>
      </div>
      <div className="layout-side">
        <div className="panel">
          <div className="panel-head"><h2>Final content</h2></div>
          <div className="panel-body" style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>{offer.content}</div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Units included</h2><span className="muted">{offer.units.length}</span></div>
          <div className="panel-body flush">
            {offer.units.map((u: any) => (
              <Link key={u.id} to={`/inventory/${u.id}`} className="row between" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
                <span><strong>{u.project} {u.unit_number}</strong> <span className="muted">{u.property_type}</span></span>
                <span className="row">{u.asking_price ? <span className="num muted">{formatMoneyShort(u.asking_price)}</span> : null}<StatusBadge status={u.status} /></span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
