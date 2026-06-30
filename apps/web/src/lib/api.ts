export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = await res.text();
    }
    throw new ApiError(res.status, `${method} ${path} -> ${res.status}`, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string): Promise<T> => request<T>('GET', p),
  post: <T>(p: string, b?: unknown): Promise<T> => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown): Promise<T> => request<T>('PUT', p, b),
  del: <T>(p: string): Promise<T> => request<T>('DELETE', p),
};
