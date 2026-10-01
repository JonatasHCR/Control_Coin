import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/**
 * Proxy the multipart XLSX upload to the Nest API, attaching the session token
 * server-side so the client never holds it. The file bytes pass straight
 * through — nothing is parsed here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId') ?? '';
  const sheet = url.searchParams.get('sheet') ?? '';

  const contentType = request.headers.get('content-type') ?? 'multipart/form-data';
  const upstream = await fetch(
    `${BASE}/data/import.xlsx?accountId=${accountId}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ''}`,
    {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': contentType, // keep the multipart boundary intact
      },
      body: await request.arrayBuffer(), // the raw multipart body
    },
  );

  const body = await upstream.json().catch(() => ({ code: 'INTERNAL' }));
  return NextResponse.json(body, { status: upstream.status });
}
