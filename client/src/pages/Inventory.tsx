import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Bookmark, CheckCircle2, Columns3, Download, Filter, Plus, Search, Trash2, X, FileText, Pencil, RotateCw } from 'lucide-react';
import { api, download, qs } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { DataGrid, type ColumnState, type GridColumn } from '../components/DataGrid';
import { InventoryFilters, describeFilters } from '../components/InventoryFilters';
import { Drawer, Dropdown, Field, Modal, Spinner, StatusBadge, Switch, TagChip, errorMessage, useConfirm, useDebounced, useToast } from '../ui';
import { useQuickCreate } from '../layout/QuickCreate';
import { countActiveFilters, type GridViewConfig, type SortSpec, type UnitFilters } from '../../../shared/filters';
import { formatDate, formatNumber, parseLooseNumber, verificationFreshness } from '../../../shared/format';
import { AgentSelect, TagPicker } from '../components/common';

export interface UnitRow {
  id: number;
  code: string;
  owner_id: number | null;
  owner_name: string | null;
  owner_phone: string | null;
  developer_id: number | null;
  developer: string | null;
  project_id: number | null;
  project: string | null;
  phase: string | null;
  unit_number: string | null;
  property_type: string | null;
  bua: number | null;
  land_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  finishing: string | null;
  furnished: string | null;
  view: string | null;
  location: string | null;
  delivery: string | null;
  asking_price: number | null;
  original_price: number | null;
  paid_amount: number | null;
  remaining_amount: number | null;
  maintenance: number | null;
  status: string;
  assigned_user_id: number | null;
  agent_name: string | null;
  source: string | null;
  last_verified: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  tags: { id: number; name: string; color: string }[];
  image_count: number;
}

const DEFAULT_COLUMNS = ['code', 'owner_name', 'owner_phone', 'developer', 'project', 'phase', 'unit_number', 'property_type', 'bua', 'land_area', 'bedrooms', 'bathrooms', 'finishing', 'delivery', 'asking_price', 'original_price', 'status', 'agent_name', 'last_verified', 'updated_at'];
const OPTIONAL_COLUMNS = ['floors', 'furnished', 'view', 'location', 'paid_amount', 'remaining_amount', 'maintenance', 'source', 'tags', 'created_at'];
const STORAGE_KEY = 'reaal.inventory.columns.v1';

function defaultColumnState(): ColumnState[] {
  return [
    ...DEFAULT_COLUMNS.map((key) => ({ key, pinned: key === 'code' })),
    ...OPTIONAL_COLUMNS.map((key) => ({ key, hidden: true })),
  ];
}

function loadColumnState(): ColumnState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return defaultColumnState();
}

function numberPatch(field: string, label: string, int = false) {
  return (v: string) => {
    const n = parseLooseNumber(v);
    if (n === undefined) return { [field]: null };
    if (Number.isNaN(n) || n < 0) throw new Error(`${label} must be a number`);
    return { [field]: int ? Math.round(n) : n };
  };
}

function optionPatch(field: string, label: string, options: () => { value: string | number; label: string }[], required = false) {
  return (v: string) => {
    if (!v.trim()) {
      if (required) throw new Error(`${label} is required`);
      return { [field]: null };
    }
    const match = options().find((o) => String(o.value) === v || o.label.toLowerCase() === v.trim().toLowerCase());
    if (!match) throw new Error(`“${v}” is not a valid ${label.toLowerCase()}`);
    return { [field]: match.value };
  };
}

const PRESETS: { name: string; filters: UnitFilters }[] = [
  { name: 'All inventory', filters: {} },
  { name: 'My Listings', filters: { mine: true } },
  { name: 'Available', filters: { status: ['Available'] } },
  { name: 'Needs Verification', filters: { verification: ['attention', 'outdated', 'never'], status: ['Available', 'Reserved', 'Pending Verification'] } },
];

export function InventoryPage() {
  const { me, can } = useAuth();
  const { master, users, values } = useData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const quick = useQuickCreate();

  const initialFilters = useMemo<UnitFilters>(() => {
    let f: UnitFilters = {};
    try {
      if (params.get('filters')) f = JSON.parse(params.get('filters')!);
    } catch {
      /* ignore */
    }
    if (params.get('q')) f.q = params.get('q')!;
    if (params.get('agent')) f.assigned_user_ids = [Number(params.get('agent'))];
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filters, setFilters] = useState<UnitFilters>(initialFilters);
  const [search, setSearch] = useState(initialFilters.q ?? '');
  const debouncedSearch = useDebounced(search, 250);
  const [sort, setSort] = useState<SortSpec[]>([]);
  const [columnState, setColumnState] = useState<ColumnState[]>(loadColumnState);
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [filterFocus, setFilterFocus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ pending: number; failed: number; retry: () => void }>({ pending: 0, failed: 0, retry: () => undefined });
  const [bulk, setBulk] = useState(false);
  const [saveView, setSaveView] = useState(false);
  const [views, setViews] = useState<any[]>([]);
  const [activeView, setActiveView] = useState<any | null>(null);
  const [showColumns, setShowColumns] = useState(false);

  const effectiveFilters = useMemo(() => ({ ...filters, q: debouncedSearch || undefined }), [filters, debouncedSearch]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columnState));
    } catch {
      /* ignore */
    }
  }, [columnState]);

  // Keep the URL shareable
  useEffect(() => {
    const next = new URLSearchParams();
    const { q, ...rest } = effectiveFilters;
    if (q) next.set('q', q);
    if (countActiveFilters(rest)) next.set('filters', JSON.stringify(rest));
    setParams(next, { replace: true });
  }, [effectiveFilters, setParams]);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get<{ total: number; rows: UnitRow[] }>(`/api/units${qs({ filters: effectiveFilters, sort, limit: 5000 })}`);
      if (id !== seq.current) return;
      setRows(r.rows);
      setTotal(r.total);
      setSelected((s) => new Set([...s].filter((x) => r.rows.some((row) => row.id === x))));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [effectiveFilters, sort, toast]);
  useEffect(() => {
    load();
  }, [load]);

  const loadViews = useCallback(() => api.get('/api/views?entity=units').then(setViews).catch(() => undefined), []);
  useEffect(() => {
    loadViews();
  }, [loadViews]);

  const onCommit = useCallback(async (rowId: number, patch: Record<string, unknown>) => {
    const updated = await api.patch<UnitRow>(`/api/units/${rowId}`, patch);
    setRows((rs) => rs.map((r) => (r.id === rowId ? updated : r)));
  }, []);

  // ------- columns -------
  const thresholds = me!.config.verification;
  const projectOptions = useCallback(() => (master?.projects ?? []).filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })), [master]);
  const developerOptions = useCallback(() => (master?.developers ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.name })), [master]);
  const agentOptions = useCallback(() => users.filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: u.name })), [users]);
  const statusOptions = useCallback(() => (master?.statuses.unit ?? []).filter((s) => s !== 'Archived' || can('inventory.delete')).map((s) => ({ value: s, label: s })), [master, can]);
  const valueOptions = useCallback((cat: string) => () => values(cat).map((v) => ({ value: v, label: v })), [values]);
  const furnishingOptions = useCallback(() => (master?.furnishing ?? []).map((v) => ({ value: v, label: v })), [master]);

  const columns = useMemo<GridColumn<UnitRow>[]>(() => {
    const text = (k: keyof UnitRow) => (r: UnitRow) => (r[k] == null ? '' : String(r[k]));
    const num = (k: keyof UnitRow) => (r: UnitRow) => (r[k] == null ? '' : formatNumber(r[k] as number));
    const textEdit = (k: string, label: string, max = 100) => ({
      type: 'text' as const,
      get: (r: UnitRow) => ((r as any)[k] ?? '') as string,
      toPatch: (v: string) => {
        if (v.length > max) throw new Error(`${label} is too long`);
        return { [k]: v.trim() || null };
      },
    });
    const numEdit = (k: string, label: string, int = false) => ({ type: 'number' as const, get: (r: UnitRow) => ((r as any)[k] == null ? '' : String((r as any)[k])), toPatch: numberPatch(k, label, int) });
    const selectEdit = (field: string, label: string, options: () => { value: string | number; label: string }[], getter: (r: UnitRow) => string, required = false) => ({ type: 'select' as const, get: getter, options, toPatch: optionPatch(field, label, options, required) });
    return [
      { key: 'code', label: 'Unit ID', width: 96, text: (r) => r.code, render: (r) => <Link to={`/inventory/${r.id}`} className="mono">{r.code}</Link>, filterable: false },
      { key: 'owner_name', label: 'Owner', width: 160, text: text('owner_name'), render: (r) => (r.owner_id ? <Link to={`/owners/${r.owner_id}`}>{r.owner_name}</Link> : <span className="muted">—</span>) },
      { key: 'owner_phone', label: 'Phone', width: 120, text: text('owner_phone'), sortable: true },
      { key: 'developer', label: 'Developer', width: 120, text: text('developer'), edit: selectEdit('developer_id', 'Developer', developerOptions, (r) => (r.developer_id ? String(r.developer_id) : '')), filterable: true },
      { key: 'project', label: 'Project', width: 140, text: text('project'), edit: selectEdit('project_id', 'Project', projectOptions, (r) => (r.project_id ? String(r.project_id) : '')), filterable: true },
      { key: 'phase', label: 'Phase', width: 90, text: text('phase'), edit: textEdit('phase', 'Phase'), filterable: true },
      { key: 'unit_number', label: 'Unit Number', width: 110, text: text('unit_number'), edit: textEdit('unit_number', 'Unit number') },
      { key: 'property_type', label: 'Property Type', width: 130, text: text('property_type'), edit: selectEdit('property_type', 'Property type', valueOptions('property_type'), (r) => r.property_type ?? ''), filterable: true },
      { key: 'bua', label: 'BUA', width: 72, align: 'right', text: num('bua'), edit: numEdit('bua', 'BUA'), filterable: true },
      { key: 'land_area', label: 'Land', width: 72, align: 'right', text: num('land_area'), edit: numEdit('land_area', 'Land'), filterable: true },
      { key: 'bedrooms', label: 'Bedrooms', width: 84, align: 'right', text: text('bedrooms'), edit: numEdit('bedrooms', 'Bedrooms', true), filterable: true },
      { key: 'bathrooms', label: 'Bathrooms', width: 90, align: 'right', text: text('bathrooms'), edit: numEdit('bathrooms', 'Bathrooms', true), filterable: true },
      { key: 'floors', label: 'Floors', width: 60, align: 'right', text: text('floors'), edit: numEdit('floors', 'Floors', true) },
      { key: 'finishing', label: 'Finishing', width: 120, text: text('finishing'), edit: selectEdit('finishing', 'Finishing', valueOptions('finishing'), (r) => r.finishing ?? ''), filterable: true },
      { key: 'furnished', label: 'Furnishing', width: 110, text: text('furnished'), edit: selectEdit('furnished', 'Furnishing', furnishingOptions, (r) => r.furnished ?? '') },
      { key: 'view', label: 'View', width: 100, text: text('view'), edit: selectEdit('view', 'View', valueOptions('view'), (r) => r.view ?? '') },
      { key: 'location', label: 'Location', width: 140, text: text('location'), edit: textEdit('location', 'Location', 300) },
      { key: 'delivery', label: 'Delivery', width: 96, text: text('delivery'), edit: textEdit('delivery', 'Delivery'), filterable: true },
      { key: 'asking_price', label: 'Asking Price', width: 118, align: 'right', text: num('asking_price'), edit: numEdit('asking_price', 'Asking price'), filterable: true },
      { key: 'original_price', label: 'Original Price', width: 118, align: 'right', text: num('original_price'), edit: numEdit('original_price', 'Original price') },
      { key: 'paid_amount', label: 'Paid', width: 110, align: 'right', text: num('paid_amount'), edit: numEdit('paid_amount', 'Paid amount') },
      { key: 'remaining_amount', label: 'Remaining', width: 110, align: 'right', text: num('remaining_amount'), edit: numEdit('remaining_amount', 'Remaining amount') },
      { key: 'maintenance', label: 'Maintenance', width: 100, align: 'right', text: num('maintenance'), edit: numEdit('maintenance', 'Maintenance') },
      { key: 'status', label: 'Status', width: 150, text: text('status'), render: (r) => <StatusBadge status={r.status} />, edit: selectEdit('status', 'Status', statusOptions, (r) => r.status, true), filterable: true },
      { key: 'agent_name', label: 'Assigned Agent', width: 130, text: text('agent_name'), edit: selectEdit('assigned_user_id', 'Agent', agentOptions, (r) => (r.assigned_user_id ? String(r.assigned_user_id) : '')), filterable: true },
      { key: 'source', label: 'Source', width: 100, text: text('source'), edit: selectEdit('source', 'Source', valueOptions('source'), (r) => r.source ?? '') },
      { key: 'tags', label: 'Tags', width: 160, sortable: false, text: (r) => r.tags.map((t) => t.name).join(', '), render: (r) => <span className="row" style={{ gap: 4 }}>{r.tags.map((t) => <TagChip key={t.id} tag={t} />)}</span>, filterable: true },
      {
        key: 'last_verified',
        label: 'Last Verified',
        width: 128,
        text: (r) => r.last_verified ?? '',
        render: (r) => {
          const f = verificationFreshness(r.last_verified, thresholds);
          return <span className={`fresh ${f}`} title={f === 'current' ? 'Current' : f === 'attention' ? 'Needs attention' : f === 'outdated' ? 'Potentially outdated' : 'Never verified'}>{r.last_verified ? formatDate(r.last_verified).replace(/ (\d{4})$/, ' $1') : 'Never'}</span>;
        },
        edit: { type: 'date', get: (r) => r.last_verified ?? '', toPatch: (v) => { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Use a date like 2026-09-18'); return { last_verified: v || null }; } },
        filterable: true,
      },
      { key: 'created_at', label: 'Created At', width: 110, text: (r) => r.created_at.slice(0, 10) },
      { key: 'updated_at', label: 'Updated At', width: 110, text: (r) => r.updated_at.slice(0, 10), filterable: true },
    ];
  }, [thresholds, projectOptions, developerOptions, agentOptions, statusOptions, valueOptions, furnishingOptions]);

  // ------- views -------
  const applyConfig = (config: GridViewConfig, view: any | null) => {
    setFilters({ ...config.filters, q: undefined });
    setSearch(config.filters.q ?? '');
    setSort(config.sort ?? []);
    if (config.columns?.length) setColumnState(config.columns);
    setActiveView(view);
  };
  const currentConfig = (): GridViewConfig => ({ filters: effectiveFilters, sort, columns: columnState });
  const updateView = async () => {
    if (!activeView) return;
    await api.patch(`/api/views/${activeView.id}`, { config: currentConfig() });
    toast(`View “${activeView.name}” updated`);
    loadViews();
  };
  const deleteView = async (v: any) => {
    if (!(await confirm({ title: `Delete view “${v.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    await api.delete(`/api/views/${v.id}`);
    if (activeView?.id === v.id) setActiveView(null);
    loadViews();
  };

  // ------- actions -------
  const selectedIds = [...selected];
  const exportRows = async (format: 'xlsx' | 'csv', scope: 'filtered' | 'selected' | 'all') => {
    try {
      const visibleCols = columnState.filter((c) => !c.hidden).map((c) => c.key).join(',');
      const q = scope === 'selected' ? { ids: selectedIds.join(','), format, columns: visibleCols } : scope === 'all' ? { format } : { filters: effectiveFilters, sort, format, columns: visibleCols };
      await download(`/api/export/units${qs(q)}`, undefined, `inventory.${format}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const verifySelected = async () => {
    await api.post('/api/units/verify', { ids: selectedIds });
    toast(`${selectedIds.length} unit${selectedIds.length === 1 ? '' : 's'} marked as verified today`);
    load();
  };
  const archiveSelected = async () => {
    if (!(await confirm({ title: `Archive ${selectedIds.length} unit(s)?`, message: 'Archived units are hidden from inventory but keep their history, offers and notes. They can be restored.', confirmLabel: 'Archive', danger: true }))) return;
    try {
      await api.post('/api/units/bulk', { ids: selectedIds, patch: { status: 'Archived' } });
      toast('Units archived');
      setSelected(new Set());
      load();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const chips = describeFilters(filters, {
    project: (id) => master?.projects.find((p) => p.id === id)?.name ?? String(id),
    developer: (id) => master?.developers.find((p) => p.id === id)?.name ?? String(id),
    user: (id) => users.find((u) => u.id === id)?.name ?? String(id),
    tag: (id) => master?.tags.find((t) => t.id === id)?.name ?? String(id),
  });
  const activeCount = chips.length;
  const filterKeyFor: Record<string, string> = { developer: 'developer', project: 'project', agent_name: 'agent_name' };

  return (
    <div className="page full" style={{ position: 'relative' }}>
      <div className="grid-toolbar">
        <h1 style={{ fontSize: 16, marginRight: 4 }}>Inventory</h1>
        <div className="input-affix" style={{ width: 260 }}>
          <Search size={15} />
          <input className="input" placeholder="Search project, unit, owner, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className={`btn ${activeCount ? 'active' : ''}`} onClick={() => { setFilterFocus(null); setShowFilters(true); }}>
          <Filter size={15} /> Filters{activeCount ? ` · ${activeCount}` : ''}
        </button>
        <Dropdown className="btn" label={<><Bookmark size={15} /> <span className="truncate" style={{ maxWidth: 140 }}>{activeView?.name ?? 'Views'}</span></>} width={260}>
          {(close) => (
            <div className="menu">
              <div className="menu-label">Quick views</div>
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => { applyConfig({ filters: p.filters, sort: [] }, null); close(); }}>{p.name}</button>
              ))}
              {views.length > 0 && <div className="menu-label">Saved views</div>}
              {views.map((v) => (
                <div key={v.id} className="row" style={{ gap: 0 }}>
                  <button className="grow" onClick={() => { applyConfig(v.config, v); close(); }}>
                    {v.name} {v.shared ? <span className="badge blue" style={{ marginLeft: 'auto' }}>Shared</span> : null}
                  </button>
                  {(v.mine || can('users.manage')) && <button onClick={() => deleteView(v)} aria-label="Delete view"><Trash2 size={13} /></button>}
                </div>
              ))}
              <div className="sep" />
              {activeView?.mine && <button onClick={() => { updateView(); close(); }}><RotateCw size={14} /> Update “{activeView.name}”</button>}
              <button onClick={() => { setSaveView(true); close(); }}><Plus size={14} /> Save current view…</button>
            </div>
          )}
        </Dropdown>
        <button className="btn" onClick={() => setShowColumns(true)}><Columns3 size={15} /> Columns</button>
        <div className="grow" />
        {saveStatus.pending > 0 && <span className="row muted" style={{ fontSize: 12 }}><Spinner /> Saving…</span>}
        {saveStatus.failed > 0 && (
          <span className="row" style={{ color: 'var(--danger)', fontSize: 12 }}>
            <AlertCircle size={14} /> {saveStatus.failed} change{saveStatus.failed === 1 ? '' : 's'} not saved
            <button className="btn sm" onClick={saveStatus.retry}>Retry</button>
          </span>
        )}
        {can('inventory.export') && (
          <Dropdown className="btn" label={<><Download size={15} /> Export</>} align="right">
            {(close) => (
              <div className="menu">
                <button onClick={() => { exportRows('xlsx', 'filtered'); close(); }}>Filtered inventory (Excel)</button>
                <button onClick={() => { exportRows('csv', 'filtered'); close(); }}>Filtered inventory (CSV)</button>
                <button disabled={!selected.size} onClick={() => { exportRows('xlsx', 'selected'); close(); }}>Selected rows (Excel)</button>
                <button onClick={() => { exportRows('xlsx', 'all'); close(); }}>Entire inventory (Excel)</button>
              </div>
            )}
          </Dropdown>
        )}
        {can('inventory.create') && <button className="btn primary" onClick={() => quick('unit', { onSaved: () => load() })}><Plus size={15} /> Add Unit</button>}
      </div>

      {chips.length > 0 && (
        <div className="grid-toolbar" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {chips.map((c) => (
            <span key={c.key} className="filter-chip">
              {c.label}
              <button onClick={() => setFilters({ ...filters, ...c.clear })} aria-label="Remove filter"><X size={12} /></button>
            </span>
          ))}
          <button className="btn ghost sm" onClick={() => { setFilters({}); setActiveView(null); }}>Clear all</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulkbar">
          <strong>{selected.size} selected</strong>
          {can('offers.create') && <button className="btn sm primary" onClick={() => navigate(`/offers/new?units=${selectedIds.join(',')}`)}><FileText size={14} /> Create Offer</button>}
          {can('inventory.edit') && <button className="btn sm" onClick={verifySelected}><CheckCircle2 size={14} /> Mark verified today</button>}
          {can('inventory.bulk_edit') && <button className="btn sm" onClick={() => setBulk(true)}><Pencil size={14} /> Bulk update</button>}
          {can('inventory.export') && <button className="btn sm" onClick={() => exportRows('xlsx', 'selected')}><Download size={14} /> Export</button>}
          {can('inventory.delete') && <button className="btn sm danger" onClick={archiveSelected}>Archive</button>}
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <DataGrid<UnitRow>
        rows={rows}
        columns={columns}
        columnState={columnState}
        onColumnStateChange={setColumnState}
        sort={sort}
        onSortChange={setSort}
        selected={selected}
        onSelectedChange={setSelected}
        onCommit={onCommit}
        canEdit={can('inventory.edit')}
        onFilterColumn={(key) => { setFilterFocus(filterKeyFor[key] ?? key); setShowFilters(true); }}
        onStatusSummary={setSaveStatus}
        rowClassName={(r) => (r.archived_at ? 'archived' : '')}
      />

      <div className="dg-footer">
        <span>{loading ? <Spinner /> : `${rows.length.toLocaleString()} of ${total.toLocaleString()} units`}</span>
        {total > rows.length && <span style={{ color: 'var(--warn)' }}>Showing the first {rows.length.toLocaleString()} — refine filters to see the rest</span>}
        <span className="grow" />
        <span className="desktop-only">Click a cell to select · Enter or type to edit · Arrows to move · Shift+click or drag to select a range · Ctrl+C / Ctrl+V to copy & paste</span>
      </div>

      {!loading && rows.length === 0 && (
        <div className="empty" style={{ position: 'absolute', left: '50%', top: '45%', transform: 'translate(-50%,-50%)' }}>
          <div style={{ fontWeight: 550 }}>No units match</div>
          {activeCount > 0 || search ? <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setFilters({}); setSearch(''); }}>Clear filters</button> : can('inventory.create') && <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => quick('unit', { onSaved: () => load() })}>Add the first unit</button>}
        </div>
      )}

      {showFilters && (
        <Drawer title="Filters" onClose={() => setShowFilters(false)} footer={<><button className="btn" onClick={() => setFilters({})}>Clear all</button><button className="btn primary" onClick={() => setShowFilters(false)}>Show {total.toLocaleString()} results</button></>}>
          <InventoryFilters filters={filters} onChange={(f) => { setFilters(f); setActiveView(null); }} focus={filterFocus} />
        </Drawer>
      )}

      {showColumns && (
        <ColumnsDialog columns={columns} state={columnState} onChange={setColumnState} onClose={() => setShowColumns(false)} onReset={() => setColumnState(defaultColumnState())} />
      )}

      {saveView && (
        <SaveViewDialog
          onClose={() => setSaveView(false)}
          onSave={async (name, shared) => {
            const r = await api.post('/api/views', { name, shared, config: currentConfig() });
            toast(`View “${name}” saved`);
            await loadViews();
            setActiveView({ id: r.id, name, shared, mine: true });
            setSaveView(false);
          }}
        />
      )}

      {bulk && (
        <BulkUpdateDialog
          count={selected.size}
          onClose={() => setBulk(false)}
          onApply={async (patch, tagIds) => {
            try {
              await api.post('/api/units/bulk', { ids: selectedIds, patch, add_tag_ids: tagIds });
              toast(`${selected.size} units updated`);
              setBulk(false);
              load();
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function ColumnsDialog({ columns, state, onChange, onClose, onReset }: { columns: GridColumn<UnitRow>[]; state: ColumnState[]; onChange: (s: ColumnState[]) => void; onClose: () => void; onReset: () => void }) {
  const ordered: ColumnState[] = [...state.filter((s) => columns.some((c) => c.key === s.key)), ...columns.filter((c) => !state.some((s) => s.key === c.key)).map((c) => ({ key: c.key, hidden: true }))];
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const update = (key: string, patch: Partial<ColumnState>) => onChange(ordered.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const next = [...ordered];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <Modal title="Columns" onClose={onClose} footer={<><button className="btn" onClick={onReset}>Reset to default</button><button className="btn primary" onClick={onClose}>Done</button></>}>
      <p className="muted" style={{ marginBottom: 10 }}>Show, hide, pin and reorder columns. You can also drag column headers and resize them in the grid.</p>
      <div className="stack tight">
        {ordered.map((s, i) => (
          <div key={s.key} className="row" style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <label className="checkbox grow">
              <input type="checkbox" checked={!s.hidden} onChange={(e) => update(s.key, { hidden: !e.target.checked })} /> {label(s.key)}
            </label>
            <label className="checkbox" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={!!s.pinned} onChange={(e) => update(s.key, { pinned: e.target.checked })} /> Pin
            </label>
            <button className="btn ghost sm icon" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn ghost sm icon" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SaveViewDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string, shared: boolean) => Promise<void> }) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  return (
    <Modal title="Save view" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), shared)}>Save view</button></>}>
      <div className="stack">
        <Field label="Name">
          <input className="input" autoFocus value={name} placeholder="e.g. Mivida Villas, Under 30M" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim(), shared)} />
        </Field>
        <Switch checked={shared} onChange={setShared} label="Share with the whole team" />
        <p className="muted" style={{ fontSize: 12 }}>Saves the current search, filters, sorting and column layout.</p>
      </div>
    </Modal>
  );
}

function BulkUpdateDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (patch: Record<string, unknown>, tagIds: number[]) => Promise<void> }) {
  const { master, values } = useData();
  const { can } = useAuth();
  const [field, setField] = useState('status');
  const [value, setValue] = useState<string>('');
  const [agent, setAgent] = useState<number | null>(null);
  const [tags, setTags] = useState<number[]>([]);
  const fields = [
    { key: 'status', label: 'Status' },
    { key: 'assigned_user_id', label: 'Assigned agent' },
    { key: 'project_id', label: 'Project' },
    { key: 'property_type', label: 'Property type' },
    { key: 'finishing', label: 'Finishing' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'phase', label: 'Phase' },
    { key: 'last_verified', label: 'Last verified' },
    { key: 'tags', label: 'Add tags' },
  ];
  const apply = () => {
    if (field === 'tags') return onApply({}, tags);
    if (field === 'assigned_user_id') return onApply({ assigned_user_id: agent }, []);
    return onApply({ [field]: value === '' ? null : field === 'project_id' ? Number(value) : value }, []);
  };
  return (
    <Modal title={`Bulk update ${count} unit${count === 1 ? '' : 's'}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={apply}>Apply to {count}</button></>}>
      <div className="stack">
        <Field label="Field">
          <select className="select" value={field} onChange={(e) => { setField(e.target.value); setValue(''); }}>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="New value">
          {field === 'status' ? (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {(master?.statuses.unit ?? []).filter((s) => s !== 'Archived' || can('inventory.delete')).map((s) => <option key={s}>{s}</option>)}
            </select>
          ) : field === 'assigned_user_id' ? (
            <AgentSelect value={agent} onChange={setAgent} />
          ) : field === 'project_id' ? (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {(master?.projects ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : field === 'property_type' || field === 'finishing' ? (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {values(field).map((v) => <option key={v}>{v}</option>)}
            </select>
          ) : field === 'last_verified' ? (
            <input className="input" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          ) : field === 'tags' ? (
            <TagPicker value={tags} onChange={setTags} />
          ) : (
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
        <p className="muted" style={{ fontSize: 12 }}>Every change is recorded in the activity log.</p>
      </div>
    </Modal>
  );
}
