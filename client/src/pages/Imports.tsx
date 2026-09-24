import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import { api, download } from '../api';
import { Empty, Loading, Spinner, StatusBadge, dateTime, errorMessage, useConfirm, useToast } from '../ui';

interface Target {
  key: string;
  label: string;
  required: boolean;
}
interface ImportState {
  id: number;
  kind: 'inventory' | 'owners';
  filename: string;
  headers: string[];
  total: number;
  preview: Record<string, string>[];
  mapping: Record<string, string>;
  fields: Target[];
}
interface Summary {
  total: number;
  ready: number;
  duplicates: number;
  errors: number;
  warnings: number;
  new_projects: string[];
  new_developers: string[];
  ignored_columns: string[];
  missing_required: string[];
}
interface RowResult {
  row: number;
  status: 'ready' | 'duplicate' | 'error';
  errors: string[];
  warnings: string[];
  data: Record<string, any>;
}

const STEPS = ['Upload', 'Preview', 'Map columns', 'Validate', 'Summary', 'Confirm'];

export function ImportsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<'inventory' | 'owners'>('inventory');
  const [imp, setImp] = useState<ImportState | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [problems, setProblems] = useState<RowResult[]>([]);
  const [problemFilter, setProblemFilter] = useState<'all' | 'error' | 'duplicate' | 'warning'>('all');
  const [policy, setPolicy] = useState<'skip' | 'create' | 'update'>('skip');
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const loadHistory = () => api.get('/api/imports').then(setHistory).catch(() => setHistory([]));
  useEffect(() => {
    loadHistory();
  }, []);

  const reset = () => {
    setStep(0);
    setImp(null);
    setSummary(null);
    setProblems([]);
    setResult(null);
    setPolicy('skip');
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) return toast('Upload an .xlsx or .csv file', 'error');
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    setBusy(true);
    try {
      const r = await api.upload<ImportState>('/api/imports', form);
      setImp(r);
      setMapping(r.mapping);
      setStep(1);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const validate = async () => {
    if (!imp) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/imports/${imp.id}/validate`, { mapping });
      setSummary(r.summary);
      setProblems(r.rows);
      setStep(3);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!imp || !summary) return;
    const importable = summary.ready + (policy === 'skip' ? 0 : summary.duplicates);
    if (!(await confirm({ title: 'Confirm import', message: `${importable.toLocaleString()} rows will be imported${policy === 'update' ? ' (duplicates update existing records)' : ''}. ${summary.errors} rows with errors will be skipped.`, confirmLabel: 'Import now' }))) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/imports/${imp.id}/confirm`, { duplicates: policy });
      setResult(r.result);
      setStep(5);
      loadHistory();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (imp && !result) await api.delete(`/api/imports/${imp.id}`).catch(() => undefined);
    reset();
    loadHistory();
  };

  const usedTargets = new Set(Object.values(mapping).filter(Boolean));
  const missingRequired = imp?.fields.filter((f) => f.required && !usedTargets.has(f.key)) ?? [];
  const shownProblems = problems.filter((p) => problemFilter === 'all' || (problemFilter === 'warning' ? p.warnings.length > 0 : p.status === problemFilter));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Import spreadsheet</h1>
          <div className="sub">Bring existing Excel or CSV databases into the system safely.</div>
        </div>
        {step > 0 && <button className="btn" onClick={cancel}>{result ? 'Start another import' : 'Cancel import'}</button>}
      </div>

      <div className="steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
            <span className="n">{i < step ? '✓' : i + 1}</span> {s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="panel panel-body stack loose">
          <div className="stack tight">
            <span className="label">What are you importing?</span>
            <div className="btn-group">
              <button className={`btn ${kind === 'inventory' ? 'active' : ''}`} onClick={() => setKind('inventory')}>Inventory (units + owners)</button>
              <button className={`btn ${kind === 'owners' ? 'active' : ''}`} onClick={() => setKind('owners')}>Owners only</button>
            </div>
          </div>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            style={{ padding: 40 }}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
          >
            {busy ? <Spinner /> : <>
              <FileSpreadsheet size={28} />
              <div style={{ fontWeight: 550, marginTop: 6 }}>Drop an .xlsx or .csv file here, or click to choose</div>
              <div style={{ fontSize: 12 }}>The first row must contain column names. Up to 20,000 rows per file.</div>
            </>}
          </div>
          <input ref={input} type="file" hidden accept=".xlsx,.csv" onChange={(e) => upload(e.target.files?.[0])} />
          <div>
            <button className="btn sm ghost" onClick={() => download(`/api/imports/template?kind=${kind}`)}><Download size={14} /> Download a blank template</button>
          </div>
        </div>
      )}

      {step === 1 && imp && (
        <div className="panel">
          <div className="panel-head">
            <h2>{imp.filename} · {imp.total.toLocaleString()} rows detected</h2>
            <button className="btn primary" onClick={() => setStep(2)}>Continue to mapping <ArrowRight size={14} /></button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 480 }}>
            <table className="table compact">
              <thead><tr><th>#</th>{imp.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {imp.preview.map((r, i) => (
                  <tr key={i}><td className="muted">{i + 2}</td>{imp.headers.map((h) => <td key={h} className="nowrap">{r[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-body muted" style={{ fontSize: 12 }}>Showing the first {imp.preview.length} rows.</div>
        </div>
      )}

      {step === 2 && imp && (
        <div className="panel">
          <div className="panel-head">
            <h2>Map spreadsheet columns to fields</h2>
            <div className="row">
              <button className="btn" onClick={() => setStep(1)}>Back</button>
              <button className="btn primary" disabled={busy || missingRequired.length > 0} onClick={validate}>{busy ? <Spinner /> : <>Validate <ArrowRight size={14} /></>}</button>
            </div>
          </div>
          {missingRequired.length > 0 && <div className="panel-body"><div className="callout warn">Map the required field{missingRequired.length > 1 ? 's' : ''}: {missingRequired.map((f) => f.label).join(', ')}</div></div>}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Spreadsheet column</th><th>Sample values</th><th style={{ width: 280 }}>Maps to</th></tr></thead>
              <tbody>
                {imp.headers.map((h) => (
                  <tr key={h}>
                    <td><strong>{h}</strong></td>
                    <td className="muted"><span className="truncate" style={{ display: 'inline-block', maxWidth: 320 }}>{imp.preview.slice(0, 3).map((r) => r[h]).filter(Boolean).join(' · ')}</span></td>
                    <td>
                      <select className="select" value={mapping[h] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}>
                        <option value="">— Ignore this column —</option>
                        {imp.fields.map((f) => (
                          <option key={f.key} value={f.key} disabled={usedTargets.has(f.key) && mapping[h] !== f.key}>
                            {f.label}{f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(step === 3 || step === 4) && summary && imp && (
        <div className="stack">
          <div className="stat-row">
            <div className="stat"><div className="v">{summary.total.toLocaleString()}</div><div className="k">rows detected</div></div>
            <div className="stat ok"><div className="v">{summary.ready.toLocaleString()}</div><div className="k">ready</div></div>
            <div className="stat warn"><div className="v">{summary.duplicates.toLocaleString()}</div><div className="k">possible duplicates</div></div>
            <div className="stat bad"><div className="v">{summary.errors.toLocaleString()}</div><div className="k">errors</div></div>
          </div>
          {(summary.new_projects.length > 0 || summary.new_developers.length > 0 || summary.ignored_columns.length > 0) && (
            <div className="panel panel-body stack tight">
              {summary.new_projects.length > 0 && <div><strong>New projects will be created:</strong> {summary.new_projects.join(', ')}</div>}
              {summary.new_developers.length > 0 && <div><strong>New developers will be created:</strong> {summary.new_developers.join(', ')}</div>}
              {summary.ignored_columns.length > 0 && <div className="muted"><strong>Unsupported / ignored columns:</strong> {summary.ignored_columns.join(', ')}</div>}
            </div>
          )}

          {step === 3 && (
            <div className="panel">
              <div className="panel-head">
                <div className="btn-group">
                  {(['all', 'error', 'duplicate', 'warning'] as const).map((f) => (
                    <button key={f} className={`btn sm ${problemFilter === f ? 'active' : ''}`} onClick={() => setProblemFilter(f)}>
                      {f === 'all' ? 'All issues' : f === 'error' ? 'Errors' : f === 'duplicate' ? 'Duplicates' : 'Warnings'}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button className="btn" onClick={() => setStep(2)}>Back to mapping</button>
                  <button className="btn primary" onClick={() => setStep(4)}>Continue <ArrowRight size={14} /></button>
                </div>
              </div>
              {shownProblems.length === 0 ? (
                <Empty icon={<CheckCircle2 size={26} color="var(--ok)" />} title="No issues found" />
              ) : (
                <div className="table-wrap" style={{ maxHeight: 460 }}>
                  <table className="table compact">
                    <thead><tr><th>Row</th><th>Result</th><th>Details</th><th>Data</th></tr></thead>
                    <tbody>
                      {shownProblems.slice(0, 500).map((p) => (
                        <tr key={p.row}>
                          <td className="muted">{p.row}</td>
                          <td>{p.status === 'error' ? <span className="badge red"><XCircle size={11} /> Error</span> : p.status === 'duplicate' ? <span className="badge yellow">Duplicate</span> : <span className="badge green">Ready</span>}</td>
                          <td>
                            {p.errors.map((e) => <div key={e} style={{ color: 'var(--danger)' }}>{e}</div>)}
                            {p.warnings.map((w) => <div key={w} className="muted row" style={{ gap: 4 }}><AlertTriangle size={11} /> {w}</div>)}
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>{[p.data.owner_name, p.data.project, p.data.unit_number].filter(Boolean).join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="panel panel-body stack loose">
              <div className="stack tight">
                <span className="label">What should happen to the {summary.duplicates} possible duplicates?</span>
                <label className="checkbox"><input type="radio" name="dup" checked={policy === 'skip'} onChange={() => setPolicy('skip')} /> Skip them (recommended)</label>
                <label className="checkbox"><input type="radio" name="dup" checked={policy === 'update'} onChange={() => setPolicy('update')} /> Update the existing records with the spreadsheet values</label>
                <label className="checkbox"><input type="radio" name="dup" checked={policy === 'create'} onChange={() => setPolicy('create')} /> Import them as new records anyway</label>
              </div>
              <div className="callout">
                {(summary.ready + (policy === 'skip' ? 0 : summary.duplicates)).toLocaleString()} rows will be imported. {summary.errors > 0 && `${summary.errors} rows with errors will be skipped — fix them in the spreadsheet and import again.`}
              </div>
              <div className="row">
                <button className="btn" onClick={() => setStep(3)}>Back</button>
                <button className="btn primary" disabled={busy} onClick={run}>{busy ? <Spinner /> : 'Confirm import'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 5 && result && (
        <div className="panel panel-body stack">
          <div className="row"><CheckCircle2 size={22} color="var(--ok)" /><h2>Import completed</h2></div>
          <div className="stat-row">
            {imp?.kind === 'inventory' && <div className="stat ok"><div className="v">{result.created_units}</div><div className="k">units created</div></div>}
            {imp?.kind === 'inventory' && <div className="stat"><div className="v">{result.updated_units}</div><div className="k">units updated</div></div>}
            <div className="stat ok"><div className="v">{result.created_owners}</div><div className="k">owners created</div></div>
            <div className="stat"><div className="v">{imp?.kind === 'inventory' ? result.linked_owners : result.updated_owners}</div><div className="k">{imp?.kind === 'inventory' ? 'linked to existing owners' : 'owners updated'}</div></div>
            <div className="stat warn"><div className="v">{result.skipped}</div><div className="k">duplicates skipped</div></div>
            <div className="stat bad"><div className="v">{result.errors}</div><div className="k">rows with errors</div></div>
          </div>
          <div className="row">
            <Link className="btn primary" to={imp?.kind === 'owners' ? '/owners' : '/inventory'}>Open {imp?.kind === 'owners' ? 'owners' : 'inventory'}</Link>
            <button className="btn" onClick={reset}><Upload size={14} /> Import another file</button>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-head"><h2>Import history</h2></div>
        {!history ? <Loading /> : history.length === 0 ? <Empty title="No imports yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Type</th><th>Status</th><th>Result</th><th>By</th><th>Date</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td><strong>{h.filename}</strong></td>
                    <td>{h.kind}</td>
                    <td><StatusBadge status={h.status} /></td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {h.result ? Object.entries(h.result).filter(([, v]) => v).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(' · ') : h.summary ? `${h.summary.total} rows · ${h.summary.errors} errors` : '—'}
                    </td>
                    <td>{h.user_name}</td>
                    <td className="muted nowrap">{dateTime(h.created_at)}</td>
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
