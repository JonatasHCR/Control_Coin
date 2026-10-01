import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** Create an alert rule. A dedicated route so it never collides with the
 *  notifications folder's own handlers under the generic proxy. */
export async function POST(request: Request): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${BASE}/notifications/rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: await request.text(),
    cache: 'no-store',
  });
  const text = await upstream.text();
  return new NextResponse(text || '{}', {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
