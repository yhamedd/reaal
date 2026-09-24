import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, EyeOff, Filter, Pin, PinOff } from 'lucide-react';
import { Popover } from '../ui';
import type { SortSpec } from '../../../shared/filters';

export interface GridOption {
  value: string | number;
  label: string;
}

export interface GridColumn<R> {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right';
  /** Plain text used for display fallback, copy and sorting hints. */
  text: (row: R) => string;
  render?: (row: R) => ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  edit?: {
    type: 'text' | 'number' | 'select' | 'date';
    /** Value shown in the editor. */
    get: (row: R) => string;
    options?: () => GridOption[];
    /** Turns editor/pasted text into a patch; throw an Error with a message for invalid input. */
    toPatch: (value: string, row: R) => Record<string, unknown>;
  };
}

export interface ColumnState {
  key: string;
  width?: number;
  hidden?: boolean;
  pinned?: boolean;
}

type CellStatus = { state: 'pending' | 'failed' | 'saved'; error?: string; patch?: Record<string, unknown> };

interface Props<R extends { id: number }> {
  rows: R[];
  columns: GridColumn<R>[];
  columnState: ColumnState[];
  onColumnStateChange: (s: ColumnState[]) => void;
  sort: SortSpec[];
  onSortChange: (s: SortSpec[]) => void;
  selected: Set<number>;
  onSelectedChange: (s: Set<number>) => void;
  onCommit: (rowId: number, patch: Record<string, unknown>) => Promise<void>;
  onFilterColumn?: (key: string) => void;
  canEdit: boolean;
  rowClassName?: (row: R) => string;
  onStatusSummary?: (s: { pending: number; failed: number; retry: () => void }) => void;
}

const ROW_H = 32;
const CHECK_W = 36;
const OVERSCAN = 12;

interface Pos {
  r: number;
  c: number;
}

export function DataGrid<R extends { id: number }>(props: Props<R>) {
  const { rows, columns, columnState, onColumnStateChange, sort, onSortChange, selected, onSelectedChange, onCommit, canEdit } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ pos: Pos; value: string } | null>(null);
  const [status, setStatus] = useState<Map<string, CellStatus>>(new Map());
  const [overrides, setOverrides] = useState<Map<number, Record<string, unknown>>>(new Map());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const lastCheck = useRef<number | null>(null);
  const mouseSelecting = useRef(false);
  const pasteHandled = useRef(false);

  // ------- visible columns in user order -------
  const visible = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const ordered: (GridColumn<R> & { w: number; pinned: boolean })[] = [];
    const seen = new Set<string>();
    for (const s of columnState) {
      const c = byKey.get(s.key);
      if (!c || seen.has(s.key)) continue;
      seen.add(s.key);
      if (s.hidden) continue;
      ordered.push({ ...c, w: s.width ?? c.width, pinned: !!s.pinned });
    }
    for (const c of columns) if (!seen.has(c.key)) ordered.push({ ...c, w: c.width, pinned: false });
    // pinned columns always come first
    return [...ordered.filter((c) => c.pinned), ...ordered.filter((c) => !c.pinned)];
  }, [columns, columnState]);

  const lefts = useMemo(() => {
    let x = CHECK_W;
    return visible.map((c) => {
      const l = x;
      x += c.w;
      return l;
    });
  }, [visible]);
  const lastPinned = visible.map((c) => c.pinned).lastIndexOf(true);

  // ------- virtualisation -------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  const rowValue = useCallback(
    (row: R): R => {
      const o = overrides.get(row.id);
      return o ? ({ ...row, ...o } as R) : row;
    },
    [overrides],
  );

  // Clamp selection when data changes
  useEffect(() => {
    if (active && (active.r >= rows.length || active.c >= visible.length)) {
      setActive(rows.length && visible.length ? { r: Math.min(active.r, rows.length - 1), c: Math.min(active.c, visible.length - 1) } : null);
      setAnchor(null);
    }
  }, [rows.length, visible.length, active]);

  const range = useMemo(() => {
    if (!active) return null;
    const a = anchor ?? active;
    return { r1: Math.min(a.r, active.r), r2: Math.max(a.r, active.r), c1: Math.min(a.c, active.c), c2: Math.max(a.c, active.c) };
  }, [active, anchor]);

  const scrollIntoView = useCallback(
    (pos: Pos) => {
      const el = scroller.current;
      if (!el) return;
      const top = pos.r * ROW_H;
      const headerH = 34;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight - headerH) el.scrollTop = top + ROW_H - el.clientHeight + headerH;
      const col = visible[pos.c];
      if (col && !col.pinned) {
        const pinnedW = lefts[lastPinned + 1] ?? CHECK_W;
        const left = lefts[pos.c];
        if (left - pinnedW < el.scrollLeft) el.scrollLeft = left - pinnedW;
        else if (left + col.w > el.scrollLeft + el.clientWidth) el.scrollLeft = left + col.w - el.clientWidth;
      }
    },
    [visible, lefts, lastPinned],
  );

  const moveTo = useCallback(
    (pos: Pos, extend = false) => {
      const p = { r: Math.max(0, Math.min(rows.length - 1, pos.r)), c: Math.max(0, Math.min(visible.length - 1, pos.c)) };
      if (extend) setAnchor((a) => a ?? active);
      else setAnchor(null);
      setActive(p);
      scrollIntoView(p);
    },
    [rows.length, visible.length, active, scrollIntoView],
  );

  // ------- saving -------
  const setCell = (key: string, s: CellStatus | null) =>
    setStatus((m) => {
      const n = new Map(m);
      if (s) n.set(key, s);
      else n.delete(key);
      return n;
    });

  const commitPatch = useCallback(
    async (row: R, colKeys: string[], patch: Record<string, unknown>) => {
      const keys = colKeys.map((k) => `${row.id}:${k}`);
      keys.forEach((k) => setCell(k, { state: 'pending', patch }));
      setOverrides((m) => new Map(m).set(row.id, { ...(m.get(row.id) ?? {}), ...patch }));
      try {
        await onCommit(row.id, patch);
        keys.forEach((k) => setCell(k, { state: 'saved' }));
        setTimeout(() => keys.forEach((k) => setStatus((m) => (m.get(k)?.state === 'saved' ? (m.delete(k), new Map(m)) : m))), 1300);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not save';
        keys.forEach((k) => setCell(k, { state: 'failed', error: msg, patch }));
      } finally {
        setOverrides((m) => {
          const n = new Map(m);
          const o = { ...(n.get(row.id) ?? {}) };
          for (const k of Object.keys(patch)) delete o[k];
          if (Object.keys(o).length) n.set(row.id, o);
          else n.delete(row.id);
          return n;
        });
      }
    },
    [onCommit],
  );

  const applyText = useCallback(
    (row: R, col: GridColumn<R>, text: string): boolean => {
      if (!col.edit || !canEdit) return false;
      const current = col.edit.get(rowValue(row));
      if (text === current) return true;
      try {
        const patch = col.edit.toPatch(text, row);
        commitPatch(row, [col.key], patch);
      } catch (e) {
        setCell(`${row.id}:${col.key}`, { state: 'failed', error: e instanceof Error ? e.message : 'Invalid value' });
      }
      return true;
    },
    [canEdit, commitPatch, rowValue],
  );

  const retryFailed = useCallback(() => {
    const byRow = new Map<number, { keys: string[]; patch: Record<string, unknown> }>();
    status.forEach((s, key) => {
      if (s.state !== 'failed' || !s.patch) return;
      const [rowId, colKey] = key.split(':');
      const entry = byRow.get(Number(rowId)) ?? { keys: [], patch: {} };
      entry.keys.push(colKey);
      Object.assign(entry.patch, s.patch);
      byRow.set(Number(rowId), entry);
    });
    byRow.forEach((v, rowId) => {
      const row = rows.find((r) => r.id === rowId);
      if (row) commitPatch(row, v.keys, v.patch);
    });
  }, [status, rows, commitPatch]);

  const { onStatusSummary } = props;
  useEffect(() => {
    let pending = 0;
    let failed = 0;
    status.forEach((s) => {
      if (s.state === 'pending') pending++;
      if (s.state === 'failed') failed++;
    });
    onStatusSummary?.({ pending, failed, retry: retryFailed });
  }, [status, onStatusSummary, retryFailed]);

  // ------- editing -------
  const startEdit = (pos: Pos, initial?: string) => {
    const col = visible[pos.c];
    const row = rows[pos.r];
    if (!col?.edit || !row || !canEdit) return;
    setEditing({ pos, value: initial ?? col.edit.get(rowValue(row)) });
  };

  const finishEdit = (commit: boolean, move?: 'down' | 'right' | 'left' | 'up') => {
    if (!editing) return;
    const { pos, value } = editing;
    setEditing(null);
    if (commit) applyText(rows[pos.r], visible[pos.c], value);
    if (move === 'down') moveTo({ r: pos.r + 1, c: pos.c });
    else if (move === 'up') moveTo({ r: pos.r - 1, c: pos.c });
    else if (move === 'right') moveTo({ r: pos.r, c: pos.c + 1 });
    else if (move === 'left') moveTo({ r: pos.r, c: pos.c - 1 });
    scroller.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (editing) {
      const el = editorRef.current;
      el?.focus();
      if (el && el.tagName === 'INPUT' && el.type !== 'date') {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, [editing?.pos.r, editing?.pos.c]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------- clipboard -------
  const copyRange = async () => {
    if (!range) return;
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const row = rowValue(rows[r]);
      const cells: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) cells.push((visible[c].text(row) ?? '').replace(/[\t\n]/g, ' '));
      lines.push(cells.join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      /* clipboard blocked */
    }
  };

  const pasteText = (text: string) => {
    if (!active || !canEdit) return;
    const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    // A single value pasted over a multi-cell selection fills the whole selection.
    const fill = matrix.length === 1 && matrix[0].length === 1 && range && (range.r2 > range.r1 || range.c2 > range.c1);
    const r0 = fill ? range!.r1 : active.r;
    const c0 = fill ? range!.c1 : active.c;
    const rCount = fill ? range!.r2 - range!.r1 + 1 : matrix.length;
    const cCount = fill ? range!.c2 - range!.c1 + 1 : Math.max(...matrix.map((m) => m.length));
    const perRow = new Map<number, { row: R; keys: string[]; patch: Record<string, unknown> }>();
    for (let i = 0; i < rCount; i++) {
      const row = rows[r0 + i];
      if (!row) break;
      for (let j = 0; j < cCount; j++) {
        const col = visible[c0 + j];
        if (!col?.edit) continue;
        const value = fill ? matrix[0][0] : matrix[i]?.[j];
        if (value === undefined) continue;
        try {
          const patch = col.edit.toPatch(value.trim(), row);
          const entry = perRow.get(row.id) ?? { row, keys: [], patch: {} };
          entry.keys.push(col.key);
          Object.assign(entry.patch, patch);
          perRow.set(row.id, entry);
        } catch (e) {
          setCell(`${row.id}:${col.key}`, { state: 'failed', error: e instanceof Error ? e.message : 'Invalid value' });
        }
      }
    }
    perRow.forEach((e) => commitPatch(e.row, e.keys, e.patch));
    setAnchor({ r: r0, c: c0 });
    setActive({ r: Math.min(rows.length - 1, r0 + rCount - 1), c: Math.min(visible.length - 1, c0 + cCount - 1) });
  };

  const clearRange = () => {
    if (!range || !canEdit) return;
    const perRow = new Map<number, { row: R; keys: string[]; patch: Record<string, unknown> }>();
    for (let r = range.r1; r <= range.r2; r++) {
      const row = rows[r];
      for (let c = range.c1; c <= range.c2; c++) {
        const col = visible[c];
        if (!col.edit) continue;
        try {
          const patch = col.edit.toPatch('', row);
          const entry = perRow.get(row.id) ?? { row, keys: [], patch: {} };
          entry.keys.push(col.key);
          Object.assign(entry.patch, patch);
          perRow.set(row.id, entry);
        } catch (e) {
          setCell(`${row.id}:${col.key}`, { state: 'failed', error: e instanceof Error ? e.message : 'Cannot be empty' });
        }
      }
    }
    perRow.forEach((e) => commitPatch(e.row, e.keys, e.patch));
  };

  const toggleRow = (id: number, index: number, shift: boolean) => {
    const next = new Set(selected);
    if (shift && lastCheck.current !== null) {
      const [a, b] = [Math.min(lastCheck.current, index), Math.max(lastCheck.current, index)];
      const on = !selected.has(id);
      for (let i = a; i <= b; i++) on ? next.add(rows[i].id) : next.delete(rows[i].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    lastCheck.current = index;
    onSelectedChange(next);
  };

  // ------- keyboard -------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !rows.length) return;
    const mod = e.ctrlKey || e.metaKey;
    const pos = active ?? { r: 0, c: 0 };
    const pageRows = Math.max(1, Math.floor(viewH / ROW_H) - 2);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return moveTo({ r: mod ? rows.length - 1 : pos.r + 1, c: pos.c }, e.shiftKey);
      case 'ArrowUp':
        e.preventDefault();
        return moveTo({ r: mod ? 0 : pos.r - 1, c: pos.c }, e.shiftKey);
      case 'ArrowRight':
        e.preventDefault();
        return moveTo({ r: pos.r, c: mod ? visible.length - 1 : pos.c + 1 }, e.shiftKey);
      case 'ArrowLeft':
        e.preventDefault();
        return moveTo({ r: pos.r, c: mod ? 0 : pos.c - 1 }, e.shiftKey);
      case 'Tab':
        e.preventDefault();
        return moveTo({ r: pos.r, c: pos.c + (e.shiftKey ? -1 : 1) });
      case 'PageDown':
        e.preventDefault();
        return moveTo({ r: pos.r + pageRows, c: pos.c }, e.shiftKey);
      case 'PageUp':
        e.preventDefault();
        return moveTo({ r: pos.r - pageRows, c: pos.c }, e.shiftKey);
      case 'Home':
        e.preventDefault();
        return moveTo({ r: mod ? 0 : pos.r, c: 0 }, e.shiftKey);
      case 'End':
        e.preventDefault();
        return moveTo({ r: mod ? rows.length - 1 : pos.r, c: visible.length - 1 }, e.shiftKey);
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (!active) return moveTo({ r: 0, c: 0 });
        if (visible[pos.c]?.edit && canEdit) startEdit(pos);
        else if (e.key === 'Enter') moveTo({ r: pos.r + (e.shiftKey ? -1 : 1), c: pos.c });
        return;
      case 'Escape':
        setAnchor(null);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return clearRange();
      case ' ':
        if (active) {
          e.preventDefault();
          toggleRow(rows[pos.r].id, pos.r, e.shiftKey);
        }
        return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copyRange();
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      // Browsers don't always fire "paste" on a non-editable element; fall back to the Clipboard API.
      pasteHandled.current = false;
      setTimeout(() => {
        if (pasteHandled.current) return;
        navigator.clipboard?.readText().then((t) => t && pasteText(t)).catch(() => undefined);
      }, 60);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setActive({ r: rows.length - 1, c: visible.length - 1 });
      return;
    }
    if (!mod && !e.altKey && e.key.length === 1 && active && visible[pos.c]?.edit && canEdit) {
      const col = visible[pos.c];
      if (col.edit!.type === 'select' || col.edit!.type === 'date') startEdit(pos);
      else startEdit(pos, e.key);
      e.preventDefault();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return;
    pasteHandled.current = true;
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      pasteText(text);
    }
  };

  // ------- header interactions -------
  const toggleSort = (key: string, add: boolean) => {
    const existing = sort.find((s) => s.key === key);
    let next: SortSpec[];
    if (!existing) next = add ? [...sort, { key, dir: 'asc' }] : [{ key, dir: 'asc' }];
    else if (existing.dir === 'asc') next = sort.map((s) => (s.key === key ? { ...s, dir: 'desc' as const } : s));
    else next = sort.filter((s) => s.key !== key);
    if (!add && existing) next = next.filter((s) => s.key === key);
    onSortChange(next);
  };

  const patchColumn = (key: string, patch: Partial<ColumnState>) => {
    const base = columnState.length ? [...columnState] : columns.map((c) => ({ key: c.key }));
    if (!base.some((s) => s.key === key)) base.push({ key });
    onColumnStateChange(base.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    const base = columnState.length ? [...columnState] : columns.map((c) => ({ key: c.key }));
    for (const c of columns) if (!base.some((s) => s.key === c.key)) base.push({ key: c.key });
    const fromIdx = base.findIndex((s) => s.key === from);
    const [item] = base.splice(fromIdx, 1);
    const toIdx = base.findIndex((s) => s.key === to);
    base.splice(toIdx, 0, item);
    onColumnStateChange(base);
  };

  const startResize = (e: React.MouseEvent, key: string, width: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const target = e.currentTarget as HTMLElement;
    target.classList.add('dragging');
    let w = width;
    const move = (ev: MouseEvent) => {
      w = Math.max(50, width + ev.clientX - startX);
      const cells = scroller.current?.querySelectorAll<HTMLElement>(`[data-col="${key}"]`);
      cells?.forEach((c) => (c.style.width = `${w}px`));
    };
    const up = () => {
      target.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      patchColumn(key, { width: Math.round(w) });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  useEffect(() => {
    const up = () => (mouseSelecting.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const totalW = CHECK_W + visible.reduce((s, c) => s + c.w, 0);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const menuCol = visible.find((c) => c.key === menuFor) ?? columns.find((c) => c.key === menuFor);
  const menuState = columnState.find((s) => s.key === menuFor);

  const renderEditor = (col: GridColumn<R>) => {
    const common = {
      ref: editorRef,
      className: 'dg-editor',
      value: editing!.value,
      onBlur: () => finishEdit(true),
      onKeyDown: (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finishEdit(true, e.shiftKey ? 'up' : 'down');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finishEdit(true, e.shiftKey ? 'left' : 'right');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finishEdit(false);
        }
      },
    };
    if (col.edit!.type === 'select') {
      const opts = col.edit!.options?.() ?? [];
      return (
        <select
          {...(common as any)}
          onChange={(e) => {
            // Selecting an option commits immediately
            const value = e.target.value;
            setEditing((ed) => (ed ? { ...ed, value } : ed));
            const pos = editing!.pos;
            setEditing(null);
            applyText(rows[pos.r], col, value);
            scroller.current?.focus({ preventScroll: true });
          }}
        >
          <option value="">—</option>
          {!opts.some((o) => String(o.value) === editing!.value) && editing!.value && <option value={editing!.value}>{editing!.value}</option>}
          {opts.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        {...(common as any)}
        type={col.edit!.type === 'date' ? 'date' : 'text'}
        inputMode={col.edit!.type === 'number' ? 'decimal' : undefined}
        onChange={(e) => setEditing((ed) => (ed ? { ...ed, value: e.target.value } : ed))}
      />
    );
  };

  return (
    <div
      ref={scroller}
      className="grid-scroller"
      tabIndex={0}
      onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={visible.length}
    >
      <div className="dg" style={{ width: totalW }}>
        <div className="dg-head" style={{ width: totalW }}>
          <div className="dg-hcell dg-check pinned" style={{ width: CHECK_W, left: 0 }}>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && selected.size > 0;
              }}
              onChange={() => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              aria-label="Select all rows"
            />
          </div>
          {visible.map((col, ci) => {
            const s = sort.find((x) => x.key === col.key);
            const sortIdx = sort.findIndex((x) => x.key === col.key);
            return (
              <div
                key={col.key}
                data-col={col.key}
                className={`dg-hcell ${col.pinned ? 'pinned' : ''} ${ci === lastPinned ? 'pinned-last' : ''} ${dragOver === col.key ? 'drag-over' : ''}`}
                style={{ width: col.w, left: col.pinned ? lefts[ci] : undefined, justifyContent: col.align === 'right' ? 'flex-end' : undefined }}
                draggable
                onDragStart={(e) => {
                  setDragKey(col.key);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragKey) {
                    e.preventDefault();
                    setDragOver(col.key);
                  }
                }}
                onDragLeave={() => setDragOver((d) => (d === col.key ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragKey) reorder(dragKey, col.key);
                  setDragKey(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDragOver(null);
                }}
                onClick={(e) => col.sortable !== false && toggleSort(col.key, e.shiftKey)}
                title={`${col.label}${col.sortable !== false ? ' — click to sort, shift-click to add a sort' : ''}`}
                role="columnheader"
                aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {col.pinned && <Pin size={11} style={{ flex: 'none', opacity: 0.5 }} />}
                <span className="label" style={{ textAlign: col.align }}>{col.label}</span>
                {s && (
                  <span className="sort">
                    {s.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    {sort.length > 1 && sortIdx + 1}
                  </span>
                )}
                <button
                  className="menu-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    menuAnchor.current = e.currentTarget;
                    setMenuFor(col.key);
                  }}
                  aria-label={`${col.label} column options`}
                >
                  <ChevronDown size={13} />
                </button>
                <div className="dg-resize" onMouseDown={(e) => startResize(e, col.key, col.w)} onClick={(e) => e.stopPropagation()} />
              </div>
            );
          })}
        </div>
        <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
          {rows.slice(first, last).map((raw, i) => {
            const r = first + i;
            const row = rowValue(raw);
            const isSel = selected.has(row.id);
            return (
              <div key={row.id} className={`dg-row ${isSel ? 'selected' : ''} ${props.rowClassName?.(row) ?? ''}`} style={{ position: 'absolute', top: r * ROW_H, width: totalW }} role="row">
                <div className="dg-cell dg-check pinned" style={{ width: CHECK_W, left: 0 }}>
                  <input type="checkbox" checked={isSel} onChange={() => undefined} onClick={(e) => toggleRow(row.id, r, e.shiftKey)} aria-label="Select row" />
                </div>
                {visible.map((col, ci) => {
                  const key = `${row.id}:${col.key}`;
                  const st = status.get(key);
                  const isActive = active?.r === r && active?.c === ci;
                  const inRange = range && r >= range.r1 && r <= range.r2 && ci >= range.c1 && ci <= range.c2 && (range.r1 !== range.r2 || range.c1 !== range.c2);
                  const isEditing = editing?.pos.r === r && editing?.pos.c === ci;
                  return (
                    <div
                      key={col.key}
                      data-col={col.key}
                      role="gridcell"
                      className={`dg-cell ${col.align === 'right' ? 'num' : ''} ${col.pinned ? 'pinned' : ''} ${ci === lastPinned ? 'pinned-last' : ''} ${!col.edit || !canEdit ? 'readonly' : ''} ${isActive ? 'active' : ''} ${inRange ? 'in-range' : ''} ${st?.state ?? ''}`}
                      style={{ width: col.w, left: col.pinned ? lefts[ci] : undefined }}
                      title={st?.state === 'failed' ? `Not saved: ${st.error}` : st?.state === 'pending' ? 'Saving…' : undefined}
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest('a,button,input')) return;
                        if (e.button !== 0) return;
                        scroller.current?.focus({ preventScroll: true });
                        if (e.shiftKey && active) {
                          setAnchor((a) => a ?? active);
                          setActive({ r, c: ci });
                        } else {
                          setAnchor({ r, c: ci });
                          setActive({ r, c: ci });
                          mouseSelecting.current = true;
                        }
                      }}
                      onMouseEnter={() => {
                        if (mouseSelecting.current) setActive({ r, c: ci });
                      }}
                      onDoubleClick={() => startEdit({ r, c: ci })}
                    >
                      {isEditing ? renderEditor(col) : col.render ? col.render(row) : col.text(row)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {menuFor && menuCol && (
        <Popover anchor={menuAnchor} onClose={() => setMenuFor(null)}>
          <div className="menu">
            {menuCol.sortable !== false && (
              <>
                <button onClick={() => { onSortChange([{ key: menuCol.key, dir: 'asc' }]); setMenuFor(null); }}><ArrowUp size={14} /> Sort ascending</button>
                <button onClick={() => { onSortChange([{ key: menuCol.key, dir: 'desc' }]); setMenuFor(null); }}><ArrowDown size={14} /> Sort descending</button>
              </>
            )}
            {props.onFilterColumn && menuCol.filterable && (
              <button onClick={() => { props.onFilterColumn!(menuCol.key); setMenuFor(null); }}><Filter size={14} /> Filter…</button>
            )}
            <div className="sep" />
            <button onClick={() => { patchColumn(menuCol.key, { pinned: !menuState?.pinned }); setMenuFor(null); }}>
              {menuState?.pinned ? <><PinOff size={14} /> Unpin column</> : <><Pin size={14} /> Pin column</>}
            </button>
            <button onClick={() => { patchColumn(menuCol.key, { hidden: true }); setMenuFor(null); }}><EyeOff size={14} /> Hide column</button>
          </div>
        </Popover>
      )}
    </div>
  );
}
