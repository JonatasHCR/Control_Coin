import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** Streams the full JSON backup the API generates, as a download. */
export async function GET(): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${BASE}/data/backup.json`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition':
        upstream.headers.get('content-disposition') ?? 'attachment; filename="control-coin-backup.json"',
    },
  });
}
