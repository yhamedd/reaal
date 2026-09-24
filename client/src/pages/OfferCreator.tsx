import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Copy, Download, FileText, MessageCircle, RefreshCw, Save, X } from 'lucide-react';
import { api, download } from '../api';
import { useAuth } from '../auth';
import { Combobox, Empty, Field, Spinner, StatusBadge, Switch, copyText, errorMessage, useToast } from '../ui';
import { formatMoneyShort } from '../../../shared/format';
import { internationalPhone } from '../../../shared/phone';

interface Template {
  key: string;
  name: string;
  description: string;
  include_owner: number;
}

interface GenResult {
  content: string;
  include_owner: boolean;
  client_name: string | null;
  tokens: { price: string[]; owner: string[] };
  units: { id: number; label: string; project: string; property_type: string; asking_price: number | null; status: string; image_count: number }[];
}

const PRICE_LINE = /price|paid|remaining|maintenance|installment|down ?payment|\bEGP\b|السعر/i;
const OWNER_LINE = /\bowner\b|المالك/i;

/** Removes lines carrying price or owner details from (possibly edited) offer text. */
export function stripLines(text: string, tokens: string[], pattern: RegExp) {
  return text
    .split('\n')
    .filter((line) => !tokens.some((t) => line.includes(t)) && !pattern.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function OfferCreatorPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [unitIds, setUnitIds] = useState<number[]>(() => (params.get('units') ?? '').split(',').map(Number).filter((n) => n > 0));
  const requirementId = Number(params.get('requirement')) || null;
  const [requirement, setRequirement] = useState<any | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [template, setTemplate] = useState('whatsapp');
  const [clientName, setClientName] = useState('');
  const [includeOwner, setIncludeOwner] = useState<boolean | null>(null);
  const [gen, setGen] = useState<GenResult | null>(null);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    api.get<Template[]>('/api/offers/templates').then(setTemplates).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!requirementId) return;
    api.get(`/api/requirements/${requirementId}`).then((r) => {
      setRequirement(r);
      setClientName((c) => c || r.client_name);
    }).catch(() => undefined);
  }, [requirementId]);

  const tpl = templates.find((t) => t.key === template);
  const ownerOn = includeOwner ?? !!tpl?.include_owner;

  const generate = useCallback(async () => {
    if (!unitIds.length) {
      setGen(null);
      setText('');
      return;
    }
    setGenerating(true);
    try {
      const r = await api.post<GenResult>('/api/offers/generate', { unit_ids: unitIds, template, client_name: clientName || null, requirement_id: requirementId, include_owner: includeOwner ?? undefined });
      setGen(r);
      setText(r.content);
      setEdited(false);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setGenerating(false);
    }
  }, [unitIds, template, clientName, requirementId, includeOwner, toast]);

  // Regenerate automatically unless the agent has edited the text.
  useEffect(() => {
    if (edited) return;
    const t = setTimeout(generate, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitIds, template, includeOwner, clientName]);

  const searchUnits = useCallback(async (q: string) => {
    const rows = await api.get<any[]>(`/api/units/lookup?q=${encodeURIComponent(q)}`);
    return rows.filter((r) => !unitIds.includes(r.id));
  }, [unitIds]);

  const variants = useMemo(() => {
    const tokens = gen?.tokens ?? { price: [], owner: [] };
    return {
      full: text,
      noPrice: stripLines(text, tokens.price, PRICE_LINE),
      noOwner: stripLines(text, tokens.owner, OWNER_LINE),
    };
  }, [text, gen]);

  const save = async (content: string, quiet = false) => {
    if (!unitIds.length || !content.trim()) return null;
    if (savedContent === content && savedId) return savedId;
    try {
      const r = await api.post('/api/offers', { unit_ids: unitIds, template, content, client_name: clientName || null, requirement_id: requirementId });
      setSavedContent(content);
      setSavedId(r.id);
      if (!quiet) toast(`Offer ${r.code} saved`);
      return r.id as number;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return null;
    }
  };

  const copy = async (content: string, label: string) => {
    if (await copyText(content)) toast(`${label} copied — paste it into WhatsApp`);
    else toast('Could not access the clipboard', 'error');
    // Copying records the offer in history so the team knows what was sent.
    save(content, true);
  };

  const pdf = async () => {
    setPdfBusy(true);
    try {
      await download('/api/offers/pdf', { unit_ids: unitIds, client_name: clientName || null, include_owner: ownerOn }, 'offer.pdf');
      save(text, true);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  const move = (i: number, d: number) => {
    const next = [...unitIds];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setUnitIds(next);
    setEdited(false);
  };

  const waTarget = requirement?.whatsapp || requirement?.phone;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Create offer</h1>
          <div className="sub">
            {requirement ? <>For <Link to={`/requirements/${requirement.id}`}>{requirement.client_name}</Link>’s requirement · </> : null}
            Editing the text never changes the property database.
          </div>
        </div>
        <Link className="btn" to="/offers">Offer history</Link>
      </div>

      <div className="offer-layout">
        <div className="stack">
          <div className="panel">
            <div className="panel-head"><h2>1. Properties</h2><span className="muted">{unitIds.length}</span></div>
            <div className="panel-body stack">
              <Combobox<any>
                value={null}
                display={(u) => u.code}
                search={searchUnits}
                renderItem={(u) => (
                  <span className="grow row between">
                    <span><strong>{u.project} {u.unit_number}</strong> <span className="muted">{u.property_type}</span></span>
                    <span className="muted">{u.asking_price ? formatMoneyShort(u.asking_price) : ''}</span>
                  </span>
                )}
                onSelect={(u) => {
                  if (u) {
                    setUnitIds((ids) => [...ids, u.id]);
                    setEdited(false);
                  }
                }}
                placeholder="Search inventory to add a unit…"
                autoFocus={!unitIds.length}
              />
              {gen?.units.map((u, i) => (
                <div key={u.id} className="unit-pill">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="truncate"><Link to={`/inventory/${u.id}`}><strong>{u.label}</strong></Link></div>
                    <div className="muted row" style={{ fontSize: 12, gap: 6 }}>
                      {u.property_type} {u.asking_price ? `· ${formatMoneyShort(u.asking_price)}` : ''}
                      {u.status !== 'Available' && <StatusBadge status={u.status} />}
                    </div>
                  </div>
                  {unitIds.length > 1 && (
                    <>
                      <button className="btn ghost sm icon" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                      <button className="btn ghost sm icon" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                    </>
                  )}
                  <button className="btn ghost sm icon" onClick={() => { setUnitIds((ids) => ids.filter((x) => x !== u.id)); setEdited(false); }} aria-label="Remove"><X size={14} /></button>
                </div>
              ))}
              {gen?.units.some((u) => u.status !== 'Available') && <div className="callout warn" style={{ fontSize: 12.5 }}>Some units are not marked Available. Double-check before sending.</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>2. Template</h2></div>
            <div className="panel-body stack">
              <div className="template-picker">
                {templates.map((t) => (
                  <button key={t.key} type="button" className={`template-card ${template === t.key ? 'active' : ''}`} onClick={() => { setTemplate(t.key); setIncludeOwner(null); setEdited(false); }}>
                    <div className="t">{t.key === 'whatsapp' ? <MessageCircle size={14} /> : <FileText size={14} />} {t.name}</div>
                    <div className="d">{t.description}</div>
                  </button>
                ))}
              </div>
              <Field label="Client name" hint="Used in the greeting. Leave empty for a generic message.">
                <input className="input" value={clientName} onChange={(e) => { setClientName(e.target.value); setEdited(false); }} placeholder="e.g. Mr. Karim" />
              </Field>
              {can('owners.contact') && <Switch checked={ownerOn} onChange={(v) => { setIncludeOwner(v); setEdited(false); }} label="Include owner information" />}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="row">3. Offer {generating && <Spinner />} {edited && <span className="badge yellow">Edited</span>}</h2>
            <button className="btn sm" onClick={() => { setEdited(false); generate(); }} disabled={!unitIds.length}><RefreshCw size={13} /> {edited ? 'Discard edits & regenerate' : 'Regenerate'}</button>
          </div>
          <div className="panel-body stack">
            {!unitIds.length ? (
              <Empty title="Add at least one property">Search inventory on the left, or select units in Inventory or a requirement’s matches and choose Create Offer.</Empty>
            ) : (
              <textarea className="textarea offer-text" value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} spellCheck />
            )}
            {unitIds.length > 0 && (
              <>
                <div className="row wrap">
                  <button className="btn primary" onClick={() => copy(variants.full, 'Offer')} disabled={!text.trim()}><Copy size={15} /> Copy Offer</button>
                  <button className="btn" onClick={() => copy(variants.noPrice, 'Offer without price')} disabled={!text.trim()}><Copy size={15} /> Copy Without Price</button>
                  <button className="btn" onClick={() => copy(variants.noOwner, 'Offer without owner information')} disabled={!text.trim()}><Copy size={15} /> Copy Without Owner Information</button>
                </div>
                <div className="row wrap">
                  <button className="btn" onClick={() => save(text)} disabled={!text.trim() || savedContent === text}><Save size={15} /> {savedContent === text ? 'Saved' : 'Save Offer'}</button>
                  <button className="btn" onClick={pdf} disabled={pdfBusy}>{pdfBusy ? <Spinner /> : <Download size={15} />} Download PDF</button>
                  <a className="btn whatsapp" href={`https://wa.me/${waTarget ? internationalPhone(waTarget) : ''}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => save(text, true)}>
                    <MessageCircle size={15} /> Open in WhatsApp{waTarget ? ` (${requirement.client_name})` : ''}
                  </a>
                  {savedId && <button className="btn ghost" onClick={() => navigate(`/offers/${savedId}`)}>View saved offer</button>}
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Copies and downloads are recorded in offer history. PDFs never include owner details unless an administrator enables it. Internal notes are never included.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
