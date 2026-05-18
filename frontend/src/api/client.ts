/**
 * 极轻量 fetch 包装。返回 JSON；失败抛 ApiError(code, message, status)。
 *
 * 鉴权：getToken() 注入 Authorization。
 */
export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let _getToken: () => string | null = () => null;
let _onUnauthenticated: () => void = () => {};

export function configureClient(opts: {
  getToken: () => string | null;
  onUnauthenticated: () => void;
}) {
  _getToken = opts.getToken;
  _onUnauthenticated = opts.onUnauthenticated;
}

type ReqOpts = { auth?: boolean; query?: Record<string, string | number | undefined> };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: ReqOpts = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const t = _getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  let url = path;
  if (opts.query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
    const q = sp.toString();
    if (q) url += `?${q}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? { code: 'INTERNAL', message: `HTTP ${res.status}` };
    if (err.code === 'UNAUTHENTICATED' || res.status === 401) _onUnauthenticated();
    throw new ApiError(err.code, err.message, res.status, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, opts?: ReqOpts) => request<T>('GET', p, undefined, opts),
  post: <T>(p: string, body?: unknown, opts?: ReqOpts) => request<T>('POST', p, body, opts),
  put: <T>(p: string, body?: unknown, opts?: ReqOpts) => request<T>('PUT', p, body, opts),
  patch: <T>(p: string, body?: unknown, opts?: ReqOpts) => request<T>('PATCH', p, body, opts),
  del: <T>(p: string, opts?: ReqOpts) => request<T>('DELETE', p, undefined, opts),
};
