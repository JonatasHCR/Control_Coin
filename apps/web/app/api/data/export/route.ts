import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/**
 * Streams the CSV the API generates, as a download. Fetches text directly
 * rather than through apiFetch (which parses JSON) — the export is CSV, and
 * the session cookie stays server-side.
 */
export async function GET(request: Request): Promise<Response> {
  const level =
    new URL(request.url).searchParams.get('level') === 'settlement' ? 'settlement' : 'transaction';
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  const upstream = await fetch(`${BASE}/data/export?level=${level}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  const csv = upstream.ok ? await upstream.text() : '';

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="control-coin-${level}.csv"`,
    },
  });
}
