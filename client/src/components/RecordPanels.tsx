import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, ImageIcon, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useData } from '../data';
import { Avatar, Empty, Loading, Spinner, dateTime, errorMessage, timeAgo, useConfirm, useToast } from '../ui';

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ActivityRow {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  entity_label: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  message: string;
  created_at: string;
}

export function entityLink(a: { entity_type: string | null; entity_id: number | null }): string | null {
  if (!a.entity_id) return null;
  switch (a.entity_type) {
    case 'unit':
      return `/inventory/${a.entity_id}`;
    case 'owner':
      return `/owners/${a.entity_id}`;
    case 'requirement':
      return `/requirements/${a.entity_id}`;
    case 'offer':
      return `/offers/${a.entity_id}`;
    default:
      return null;
  }
}

/** Renders the stored message with the record label turned into a link. */
function ActivityMessage({ a }: { a: ActivityRow }) {
  const link = entityLink(a);
  if (link && a.entity_label && a.message.includes(a.entity_label)) {
    const i = a.message.indexOf(a.entity_label);
    return (
      <>
        {a.message.slice(0, i)}
        <Link to={link}>{a.entity_label}</Link>
        {a.message.slice(i + a.entity_label.length)}
      </>
    );
  }
  return <>{a.message}</>;
}

export function ActivityItem({ a }: { a: ActivityRow }) {
  return (
    <div className="feed-item">
      <Avatar name={a.user_name ?? 'System'} />
      <div className="grow">
        <div>
          <strong>{a.user_name ?? 'System'}</strong> <ActivityMessage a={a} />
        </div>
      </div>
      <span className="when" title={dateTime(a.created_at)}>{timeAgo(a.created_at)}</span>
    </div>
  );
}

export function ActivityList({ entityType, entityId, reloadKey }: { entityType: string; entityId: number; reloadKey?: unknown }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  useEffect(() => {
    api.get(`/api/activity?entity_type=${entityType}&entity_id=${entityId}&limit=100`).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [entityType, entityId, reloadKey]);
  if (!rows) return <Loading />;
  if (!rows.length) return <Empty title="No activity yet" />;
  return (
    <div className="feed">
      {rows.map((a) => (
        <ActivityItem key={a.id} a={a} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

interface Note {
  id: number;
  content: string;
  author_id: number;
  author_name: string;
  created_at: string;
}

function highlightMentions(text: string, names: string[]): ReactNode[] {
  if (!names.length || !text.includes('@')) return [text];
  const sorted = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(@(?:${sorted.join('|')}))`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <span key={i} className="mention">{part}</span> : part));
}

export function NotesPanel({ entityType, entityId, onChange }: { entityType: string; entityId: number; onChange?: () => void }) {
  const { me, can } = useAuth();
  const { users } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    api.get<Note[]>(`/api/notes?entity_type=${entityType}&entity_id=${entityId}`).then(setNotes).catch(() => setNotes([]));
  }, [entityType, entityId]);
  useEffect(load, [load]);

  const add = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/notes', { entity_type: entityType, entity_id: entityId, content: text });
      setText('');
      load();
      onChange?.();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: Note) => {
    if (!(await confirm({ title: 'Delete note?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    await api.delete(`/api/notes/${n.id}`);
    load();
  };

  const onType = (value: string, caret: number) => {
    setText(value);
    const before = value.slice(0, caret);
    const m = before.match(/@([\p{L}\d]*(?: [\p{L}\d]*)?)$/u);
    setMention(m ? { q: m[1].toLowerCase(), start: caret - m[0].length } : null);
  };
  const candidates = mention ? users.filter((u) => u.status === 'active' && u.name.toLowerCase().startsWith(mention.q)).slice(0, 5) : [];
  const insertMention = (name: string) => {
    if (!mention) return;
    const caret = ta.current?.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + `@${name} ` + text.slice(caret);
    setText(next);
    setMention(null);
    setTimeout(() => ta.current?.focus());
  };

  return (
    <div className="stack">
      <div style={{ position: 'relative' }}>
        <textarea
          ref={ta}
          className="textarea"
          placeholder="Add an internal note… Use @ to mention a teammate. Notes are never included in offers."
          value={text}
          onChange={(e) => onType(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (candidates.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault();
              insertMention(candidates[0].name);
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
          }}
        />
        {candidates.length > 0 && (
          <div className="popover menu" style={{ left: 8, top: '100%' }}>
            {candidates.map((u) => (
              <button key={u.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(u.name)}>
                <Avatar name={u.name} /> {u.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="row between">
        <span className="muted" style={{ fontSize: 12 }}>Ctrl + Enter to save</span>
        <button className="btn primary sm" disabled={!text.trim() || saving} onClick={add}>{saving ? <Spinner /> : 'Add note'}</button>
      </div>
      {!notes ? (
        <Loading />
      ) : notes.length === 0 ? (
        <div className="muted" style={{ padding: '8px 0' }}>No notes yet.</div>
      ) : (
        <div>
          {notes.map((n) => (
            <div key={n.id} className="note">
              <div className="meta">
                <strong style={{ color: 'var(--text-2)' }}>{n.author_name ?? 'Unknown'}</strong>
                <span title={dateTime(n.created_at)}>{dateTime(n.created_at)}</span>
                {(n.author_id === me?.id || can('users.manage')) && (
                  <button className="btn ghost sm icon" style={{ marginLeft: 'auto' }} onClick={() => remove(n)} aria-label="Delete note"><Trash2 size={13} /></button>
                )}
              </div>
              <div className="body">{highlightMentions(n.content, users.map((u) => u.name))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files & media
// ---------------------------------------------------------------------------

export interface FileRow {
  id: number;
  category: string;
  original_name: string;
  mime: string;
  size: number;
  uploaded_by_name?: string;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = { image: 'Photos', floor_plan: 'Floor plans', master_plan: 'Master plans', document: 'Documents' };

export function FilesPanel({ entityType, entityId, files, onChange, canEdit, categories = ['image', 'floor_plan', 'master_plan', 'document'] }: {
  entityType: string;
  entityId: number;
  files: FileRow[];
  onChange: () => void;
  canEdit: boolean;
  categories?: string[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [category, setCategory] = useState(categories[0]);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const form = new FormData();
    form.set('entity_type', entityType);
    form.set('entity_id', String(entityId));
    form.set('category', category);
    Array.from(list).forEach((f) => form.append('files', f));
    setUploading(true);
    try {
      await api.upload('/api/files', form);
      toast(`${list.length} file${list.length === 1 ? '' : 's'} uploaded`);
      onChange();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (f: FileRow) => {
    if (!(await confirm({ title: 'Remove file?', message: f.original_name, confirmLabel: 'Remove', danger: true }))) return;
    await api.delete(`/api/files/${f.id}`);
    onChange();
  };

  const move = async (f: FileRow, cat: string) => {
    await api.patch(`/api/files/${f.id}`, { category: cat });
    onChange();
  };

  return (
    <div className="stack loose">
      {canEdit && (
        <div className="stack tight">
          <div className="row wrap">
            <span className="label">Upload as</span>
            <div className="btn-group">
              {categories.map((c) => (
                <button key={c} type="button" className={`btn sm ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{CATEGORY_LABELS[c]}</button>
              ))}
            </div>
          </div>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          >
            {uploading ? <Spinner /> : <><Upload size={18} /> <div>Drop files here or click to upload {CATEGORY_LABELS[category].toLowerCase()}</div><div style={{ fontSize: 11.5 }}>JPG, PNG, WebP, PDF, Office documents</div></>}
          </div>
          <input ref={input} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => upload(e.target.files)} />
        </div>
      )}
      {categories.map((c) => {
        const list = files.filter((f) => f.category === c);
        if (!list.length) return null;
        const images = list.filter((f) => f.mime?.startsWith('image/'));
        const docs = list.filter((f) => !f.mime?.startsWith('image/'));
        return (
          <div key={c}>
            <div className="section-title">{CATEGORY_LABELS[c]} ({list.length})</div>
            {images.length > 0 && (
              <div className="gallery">
                {images.map((f) => (
                  <div key={f.id} className="thumb">
                    <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${f.id}`} alt={f.original_name} loading="lazy" /></a>
                    {canEdit && (
                      <div className="thumb-actions">
                        <select className="select sm" style={{ width: 110 }} value={f.category} onChange={(e) => move(f, e.target.value)} aria-label="Category">
                          {categories.map((x) => <option key={x} value={x}>{CATEGORY_LABELS[x]}</option>)}
                        </select>
                        <button className="btn sm icon" onClick={() => remove(f)} aria-label="Remove"><Trash2 size={13} /></button>
                      </div>
                    )}
                    <div className="cap truncate">{f.original_name}</div>
                  </div>
                ))}
              </div>
            )}
            {docs.map((f) => (
              <div key={f.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                {f.mime === 'application/pdf' ? <FileText size={16} /> : <ImageIcon size={16} />}
                <a className="grow truncate" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.original_name}</a>
                <span className="muted" style={{ fontSize: 12 }}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                <a className="btn ghost sm icon" href={`/api/files/${f.id}?download=1`} aria-label="Download"><Download size={14} /></a>
                {canEdit && <button className="btn ghost sm icon" onClick={() => remove(f)} aria-label="Remove"><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
        );
      })}
      {!files.length && !canEdit && <Empty title="No files" />}
    </div>
  );
}
