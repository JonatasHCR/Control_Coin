import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** Streams the fill-in workbook, pre-filled with the user's cadastros. */
export async function GET(request: Request): Promise<Response> {
  const parts = new URL(request.url).searchParams.get('parts') ?? '';
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${BASE}/data/template.xlsx?parts=${encodeURIComponent(parts)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="control-coin-modelo.xlsx"',
    },
  });
}
