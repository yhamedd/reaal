export class ApiError extends Error {
  status: number;
  body: any;
  fields: Record<string, string>;
  constructor(status: number, body: any) {
    super(body?.error || (status === 413 ? 'That file is too large to upload. Try a smaller file (about 4 MB max).' : `Request failed (${status})`));
    this.status = status;
    this.body = body;
    this.fields = body?.fields ?? {};
  }
}

type Listener = (status: number, headers: Headers) => void;
const listeners = new Set<Listener>();
export function onAuthProblem(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'reaal', ...(init.headers as Record<string, string>) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, credentials: 'same-origin', ...init, headers, body: payload });
  if (res.status === 401 || res.status === 428) listeners.forEach((l) => l(res.status, res.headers));
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  delete: <T = any>(url: string, body?: unknown) => request<T>('DELETE', url, body ?? {}),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form),
};

export function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    sp.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Downloads a file produced by a POST (PDF) or GET (export) request. */
export async function download(url: string, body?: unknown, fallbackName = 'download') {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'reaal', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(cd.match(/filename="?([^"]+)"?/)?.[1] ?? fallbackName);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
