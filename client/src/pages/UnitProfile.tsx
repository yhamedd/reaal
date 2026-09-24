import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, CheckCircle2, ChevronRight, Copy, FileText, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Drawer, Dropdown, Loading, StatusBadge, TagChip, copyText, dateTime, errorMessage, timeAgo, useConfirm, useToast } from '../ui';
import { ActivityList, FilesPanel, NotesPanel } from '../components/RecordPanels';
import { UnitForm } from '../components/UnitForm';
import { ContactButtons } from '../components/ContactButtons';
import { NotFound } from './Errors';
import { daysSince, formatDate, formatMoney, formatNumber, verificationFreshness } from '../../../shared/format';

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="kv">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

export function UnitPage() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const { master } = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [unit, setUnit] = useState<any | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api.get(`/api/units/${id}`).then(setUnit).catch(() => setMissing(true));
  }, [id]);
  useEffect(load, [load]);
  const refresh = () => {
    load();
    setTick((t) => t + 1);
  };

  if (missing) return <NotFound />;
  if (!unit) return <Loading />;

  const currency = me!.config.currency;
  const title = [unit.project, unit.unit_number].filter(Boolean).join(' ') || unit.code;
  const freshness = verificationFreshness(unit.last_verified, me!.config.verification);
  const age = daysSince(unit.last_verified);
  const canEdit = can('inventory.edit');

  const setStatus = async (status: string) => {
    try {
      await api.patch(`/api/units/${unit.id}`, { status });
      toast(`Status changed to ${status}`);
      refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const verify = async () => {
    await api.post('/api/units/verify', { ids: [unit.id] });
    toast('Marked as verified today');
    refresh();
  };
  const archive = async () => {
    if (!(await confirm({ title: `Archive ${title}?`, message: 'The unit will be hidden from inventory. Its offers, notes, ownership and history are preserved and it can be restored.', confirmLabel: 'Archive', danger: true }))) return;
    await api.post(`/api/units/${unit.id}/archive`);
    refresh();
  };
  const restore = async () => {
    await api.post(`/api/units/${unit.id}/restore`);
    toast('Unit restored as Pending Verification');
    refresh();
  };
  const purge = async () => {
    if (!(await confirm({ title: 'Delete permanently?', message: 'This removes the unit, its notes and files for good. Offer history that references it will lose this unit. This cannot be undone.', confirmLabel: 'Delete permanently', danger: true, typeToConfirm: unit.code }))) return;
    try {
      await api.delete(`/api/units/${unit.id}`, { confirm: unit.code, force: true });
      toast('Unit deleted');
      navigate('/inventory');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/inventory">Inventory</Link> <ChevronRight size={12} /> <span className="mono">{unit.code}</span>
        <button className="btn ghost sm icon" onClick={() => copyText(unit.code).then(() => toast('Unit ID copied'))} aria-label="Copy unit ID"><Copy size={12} /></button>
      </div>
      <div className="profile-head">
        <div className="stack tight">
          <div className="row wrap">
            <h1>{title}</h1>
            <StatusBadge status={unit.status} large />
          </div>
          <div className="text-2">
            {[unit.property_type, unit.phase, unit.developer].filter(Boolean).join(' · ')}
            {unit.asking_price ? <> · <strong>{formatMoney(unit.asking_price, currency)}</strong></> : null}
          </div>
          {unit.tags.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{unit.tags.map((t: any) => <TagChip key={t.id} tag={t} />)}</div>}
        </div>
        <div className="row wrap">
          {can('offers.create') && unit.status !== 'Archived' && (
            <button className="btn primary" onClick={() => navigate(`/offers/new?units=${unit.id}`)}><FileText size={15} /> Create Offer</button>
          )}
          {canEdit && <button className="btn" onClick={verify}><CheckCircle2 size={15} /> Mark as Verified Today</button>}
          {canEdit && (
            <Dropdown className="btn" label={<>Status <StatusBadge status={unit.status} /></>} align="right">
              {(close) => (
                <div className="menu">
                  {(master?.statuses.unit ?? []).filter((s) => s !== 'Archived').map((s) => (
                    <button key={s} disabled={s === unit.status} onClick={() => { close(); setStatus(s); }}><StatusBadge status={s} /></button>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
          {canEdit && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>}
          {(can('inventory.delete') || can('records.purge')) && (
            <Dropdown className="btn icon" label={<MoreHorizontal size={16} />} align="right" title="More">
              {(close) => (
                <div className="menu">
                  {can('inventory.delete') && (unit.archived_at ? (
                    <button onClick={() => { close(); restore(); }}><RotateCcw size={14} /> Restore</button>
                  ) : (
                    <button onClick={() => { close(); archive(); }}><Archive size={14} /> Archive</button>
                  ))}
                  {can('records.purge') && unit.archived_at && <button className="danger" onClick={() => { close(); purge(); }}><Trash2 size={14} /> Delete permanently</button>}
                </div>
              )}
            </Dropdown>
          )}
        </div>
      </div>

      {unit.archived_at && <div className="callout warn" style={{ marginBottom: 14 }}>This unit was archived {timeAgo(unit.archived_at)}. It is hidden from inventory and matching.</div>}

      <div className="layout-side">
        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h2>Property details</h2></div>
            <div className="panel-body kv-grid">
              <KV k="Unit ID" v={<span className="mono">{unit.code}</span>} />
              <KV k="Developer" v={unit.developer} />
              <KV k="Project" v={unit.project} />
              <KV k="Phase" v={unit.phase} />
              <KV k="Unit number" v={unit.unit_number} />
              <KV k="Property type" v={unit.property_type} />
              <KV k="BUA" v={unit.bua != null ? `${formatNumber(unit.bua)} sqm` : null} />
              <KV k="Land area" v={unit.land_area != null ? `${formatNumber(unit.land_area)} sqm` : null} />
              <KV k="Bedrooms" v={unit.bedrooms} />
              <KV k="Bathrooms" v={unit.bathrooms} />
              <KV k="Floors" v={unit.floors} />
              <KV k="Finishing" v={unit.finishing} />
              <KV k="Furnishing" v={unit.furnished} />
              <KV k="View" v={unit.view} />
              <KV k="Location" v={unit.location} />
              <KV k="Delivery" v={unit.delivery} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Financial information</h2></div>
            <div className="panel-body kv-grid">
              <KV k="Asking price" v={unit.asking_price != null ? <strong>{formatMoney(unit.asking_price, currency)}</strong> : <span className="muted">Not set</span>} />
              <KV k="Original price" v={unit.original_price != null ? formatMoney(unit.original_price, currency) : null} />
              <KV k="Paid amount" v={unit.paid_amount != null ? formatMoney(unit.paid_amount, currency) : null} />
              <KV k="Remaining amount" v={unit.remaining_amount != null ? formatMoney(unit.remaining_amount, currency) : null} />
              <KV k="Maintenance" v={unit.maintenance != null ? formatMoney(unit.maintenance, currency) : null} />
            </div>
            {unit.payment_notes && <div className="panel-body" style={{ borderTop: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}><div className="section-title">Payment notes</div>{unit.payment_notes}</div>}
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Media</h2><span className="muted" style={{ fontSize: 12 }}>Images, floor plans, master plans & documents</span></div>
            <div className="panel-body">
              <FilesPanel entityType="unit" entityId={unit.id} files={unit.files} canEdit={canEdit} onChange={refresh} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Activity</h2></div>
            <ActivityList entityType="unit" entityId={unit.id} reloadKey={tick} />
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h2>Ownership</h2></div>
            <div className="panel-body stack">
              {unit.owner_id ? (
                <>
                  <div>
                    <Link to={`/owners/${unit.owner_id}`} style={{ fontWeight: 600, fontSize: 15 }}>{unit.owner_name}</Link>
                    {unit.owner_status && unit.owner_status !== 'Active' && <> <StatusBadge status={unit.owner_status} /></>}
                  </div>
                  <dl className="dl" style={{ margin: 0 }}>
                    {unit.owner_phone && <><dt>Primary phone</dt><dd>{unit.owner_phone}</dd></>}
                    {unit.owner_secondary_phone && <><dt>Secondary phone</dt><dd>{unit.owner_secondary_phone}</dd></>}
                    {unit.owner_whatsapp && unit.owner_whatsapp !== unit.owner_phone && <><dt>WhatsApp</dt><dd>{unit.owner_whatsapp}</dd></>}
                    <dt>Assigned agent</dt><dd>{unit.agent_name ?? <span className="muted">Unassigned</span>}</dd>
                  </dl>
                  {unit.owner_status !== 'Do Not Contact' && (
                    <div className="row wrap"><ContactButtons phone={unit.owner_phone} whatsapp={unit.owner_whatsapp} ownerId={unit.owner_id} size="sm" hidden={unit.contact_hidden} /></div>
                  )}
                  {unit.owner_status === 'Do Not Contact' && <div className="callout danger">Owner has asked not to be contacted.</div>}
                </>
              ) : (
                <div className="muted">No owner linked. {canEdit && <a href="#" onClick={(e) => { e.preventDefault(); setEditing(true); }}>Add owner</a>}</div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Internal information</h2></div>
            <div className="panel-body">
              <dl className="dl" style={{ margin: 0 }}>
                <dt>Last verified</dt>
                <dd>
                  <span className={`fresh ${freshness}`}>{unit.last_verified ? `${formatDate(unit.last_verified)} (${age === 0 ? 'today' : `${age}d ago`})` : 'Never'}</span>
                </dd>
                <dt>Source</dt><dd>{unit.source ?? '—'}</dd>
                <dt>Date added</dt><dd>{dateTime(unit.created_at)}</dd>
                <dt>Added by</dt><dd>{unit.created_by_name ?? '—'}</dd>
                <dt>Last updated</dt><dd>{timeAgo(unit.updated_at)}</dd>
              </dl>
              {freshness !== 'current' && canEdit && (
                <button className="btn sm" style={{ marginTop: 10 }} onClick={verify}><CheckCircle2 size={14} /> Mark as Verified Today</button>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Internal notes</h2></div>
            <div className="panel-body"><NotesPanel entityType="unit" entityId={unit.id} onChange={() => setTick((t) => t + 1)} /></div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Offer history</h2><span className="muted">{unit.offers.length}</span></div>
            <div className="panel-body flush">
              {unit.offers.length === 0 ? (
                <div className="muted" style={{ padding: 14 }}>Not offered yet.</div>
              ) : (
                unit.offers.map((o: any) => (
                  <Link key={o.id} to={`/offers/${o.id}`} className="row between" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none' }}>
                    <span>{o.client_name ?? 'No client'} <span className="muted">· {o.template}</span></span>
                    <span className="muted" style={{ fontSize: 12 }}>{o.created_by_name} · {timeAgo(o.created_at)}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <Drawer title={`Edit ${title}`} onClose={() => setEditing(false)} wide>
          <UnitForm unit={unit} onSaved={() => { setEditing(false); refresh(); }} onCancel={() => setEditing(false)} />
        </Drawer>
      )}
    </div>
  );
}
