let refreshing: Promise<boolean> | null = null;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    refreshing ||= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .finally(() => {
        refreshing = null;
      });
    if (await refreshing) return api<T>(path, options, false);
  }
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ message: 'Unable to connect. Please try again.' }));
    throw new ApiError(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Something went wrong',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const post = <T>(path: string, body: unknown = {}, key?: string) =>
  api<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    ...(key ? { headers: { 'idempotency-key': key } } : {}),
  });
export const money = (minor: number) =>
  new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(minor / 100);
export const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', ...options }).format(new Date(date));
export const timeLabel = (date: string) =>
  dateLabel(date, { hour: 'numeric', minute: '2-digit', hour12: true });
export const localDate = (offset = 0) => {
  const date = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};
