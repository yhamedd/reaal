import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronRight, FileText, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Avatar, Drawer, Dropdown, Empty, Loading, StatusBadge, TagChip, dateTime, errorMessage, timeAgo, useConfirm, useToast } from '../ui';
import { ActivityList, FilesPanel, NotesPanel } from '../components/RecordPanels';
import { OwnerForm } from '../components/OwnerForm';
import { ContactButtons } from '../components/ContactButtons';
import { useQuickCreate } from '../layout/QuickCreate';
import { NotFound } from './Errors';
import { formatMoneyShort, formatNumber } from '../../../shared/format';

export function OwnerPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const quick = useQuickCreate();
  const [owner, setOwner] = useState<any | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'notes' | 'activity' | 'files'>('notes');
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api.get(`/api/owners/${id}`).then(setOwner).catch(() => setMissing(true));
    api.get(`/api/files?entity_type=owner&entity_id=${id}`).then(setFiles).catch(() => undefined);
  }, [id]);
  useEffect(load, [load]);

  if (missing) return <NotFound />;
  if (!owner) return <Loading />;

  const archive = async () => {
    if (!(await confirm({ title: `Archive ${owner.name}?`, message: 'Archived owners keep their units, notes and history.', confirmLabel: 'Archive', danger: true }))) return;
    await api.post(`/api/owners/${owner.id}/archive`);
    load();
  };
  const restore = async () => {
    await api.post(`/api/owners/${owner.id}/restore`);
    load();
  };
  const purge = async () => {
    if (!(await confirm({ title: 'Delete owner permanently?', message: 'Their units stay in inventory without an owner. Notes and files are deleted. This cannot be undone.', danger: true, confirmLabel: 'Delete permanently', typeToConfirm: owner.name }))) return;
    try {
      await api.delete(`/api/owners/${owner.id}`, { confirm: owner.name });
      navigate('/owners');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const units = owner.units.filter((u: any) => !u.archived_at);
  const archivedUnits = owner.units.filter((u: any) => u.archived_at);

  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/owners">Owners</Link> <ChevronRight size={12} /> <span className="mono">{owner.code}</span></div>
      <div className="profile-head">
        <div className="row top" style={{ gap: 14 }}>
          <Avatar name={owner.name} large />
          <div className="stack tight">
            <div className="row wrap">
              <h1>{owner.name}</h1>
              <StatusBadge status={owner.status} />
            </div>
            {owner.name_ar && <div dir="rtl" className="text-2" style={{ fontSize: 15, textAlign: 'left' }}>{owner.name_ar}</div>}
            <div className="text-2">
              {owner.unit_count} propert{owner.unit_count === 1 ? 'y' : 'ies'} · {owner.agent_name ? `Agent: ${owner.agent_name}` : 'Unassigned'}
              {owner.last_contacted && ` · Last contacted ${timeAgo(owner.last_contacted)}`}
            </div>
            {owner.tags.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{owner.tags.map((t: any) => <TagChip key={t.id} tag={t} />)}</div>}
          </div>
        </div>
        <div className="row wrap">
          {owner.status !== 'Do Not Contact' && <ContactButtons phone={owner.primary_phone} whatsapp={owner.whatsapp} ownerId={owner.id} hidden={owner.contact_hidden} />}
          {can('inventory.create') && <button className="btn" onClick={() => quick('unit', { ownerId: owner.id, ownerName: owner.name, onSaved: () => load() })}><Plus size={15} /> Add Unit</button>}
          {can('owners.edit') && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> Edit Owner</button>}
          {(can('owners.delete') || can('records.purge')) && (
            <Dropdown className="btn icon" label={<MoreHorizontal size={16} />} align="right" title="More">
              {(close) => (
                <div className="menu">
                  {can('owners.delete') && (owner.archived_at ? <button onClick={() => { close(); restore(); }}><RotateCcw size={14} /> Restore</button> : <button onClick={() => { close(); archive(); }}><Archive size={14} /> Archive</button>)}
                  {can('records.purge') && owner.archived_at && <button className="danger" onClick={() => { close(); purge(); }}><Trash2 size={14} /> Delete permanently</button>}
                </div>
              )}
            </Dropdown>
          )}
        </div>
      </div>

      {owner.status === 'Do Not Contact' && <div className="callout danger" style={{ marginBottom: 14 }}>This owner has asked not to be contacted.</div>}

      <div className="layout-side">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Properties owned</h2>
              {can('offers.create') && units.length > 0 && (
                <button className="btn sm" onClick={() => navigate(`/offers/new?units=${units.map((u: any) => u.id).join(',')}`)}><FileText size={14} /> Offer all</button>
              )}
            </div>
            {owner.units.length === 0 ? (
              <Empty title="No properties yet">{can('inventory.create') && <button className="btn sm primary" onClick={() => quick('unit', { ownerId: owner.id, ownerName: owner.name, onSaved: () => load() })}>Add unit</button>}</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Project</th><th>Unit</th><th>Type</th><th className="right">BUA</th><th className="right">Asking</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {[...units, ...archivedUnits].map((u: any) => (
                      <tr key={u.id} className="clickable" onClick={() => navigate(`/inventory/${u.id}`)} style={u.archived_at ? { opacity: 0.55 } : undefined}>
                        <td><strong>{u.project ?? '—'}</strong>{u.phase && <span className="muted"> · {u.phase}</span>}</td>
                        <td>{u.unit_number}</td>
                        <td>{u.property_type}</td>
                        <td className="right num">{u.bua ? `${formatNumber(u.bua)} sqm` : ''}</td>
                        <td className="right num">{u.asking_price ? formatMoneyShort(u.asking_price) : ''}</td>
                        <td><StatusBadge status={u.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panel-body" style={{ paddingBottom: 0 }}>
              <div className="tabs">
                <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notes</button>
                <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
                <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files ({files.length})</button>
              </div>
            </div>
            {tab === 'notes' && <div className="panel-body" style={{ paddingTop: 0 }}><NotesPanel entityType="owner" entityId={owner.id} onChange={() => setTick((t) => t + 1)} /></div>}
            {tab === 'activity' && <ActivityList entityType="owner" entityId={owner.id} reloadKey={tick} />}
            {tab === 'files' && <div className="panel-body" style={{ paddingTop: 0 }}><FilesPanel entityType="owner" entityId={owner.id} files={files} canEdit={can('owners.edit')} categories={['document', 'image']} onChange={load} /></div>}
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h2>Contact information</h2></div>
            <div className="panel-body">
              {owner.contact_hidden && <div className="callout" style={{ marginBottom: 10 }}>Contact details are hidden for your role.</div>}
              <dl className="dl" style={{ margin: 0 }}>
                <dt>Primary phone</dt><dd>{owner.primary_phone ?? '—'}</dd>
                <dt>Secondary phone</dt><dd>{owner.secondary_phone ?? '—'}</dd>
                <dt>WhatsApp</dt><dd>{owner.whatsapp ?? '—'}</dd>
                <dt>Email</dt><dd>{owner.email ? (owner.contact_hidden ? owner.email : <a href={`mailto:${owner.email}`}>{owner.email}</a>) : '—'}</dd>
                <dt>Address</dt><dd>{owner.address ?? '—'}</dd>
              </dl>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Details</h2></div>
            <div className="panel-body">
              <dl className="dl" style={{ margin: 0 }}>
                <dt>Owner ID</dt><dd className="mono">{owner.code}</dd>
                <dt>Assigned agent</dt><dd>{owner.agent_name ?? '—'}</dd>
                <dt>Source</dt><dd>{owner.source ?? '—'}</dd>
                <dt>Created</dt><dd>{dateTime(owner.created_at)}</dd>
                <dt>Created by</dt><dd>{owner.created_by_name ?? '—'}</dd>
                <dt>Last updated</dt><dd>{timeAgo(owner.updated_at)}</dd>
                <dt>Last contacted</dt><dd>{owner.last_contacted ? dateTime(owner.last_contacted) : '—'}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
      {editing && (
        <Drawer title={`Edit ${owner.name}`} onClose={() => setEditing(false)}>
          <OwnerForm owner={owner} onSaved={() => { setEditing(false); load(); setTick((t) => t + 1); }} onCancel={() => setEditing(false)} />
        </Drawer>
      )}
    </div>
  );
}
