import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** Proxies the filled workbook upload, attaching the session token server-side. */
export async function POST(request: Request): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${BASE}/data/import-workbook`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': request.headers.get('content-type') ?? 'multipart/form-data',
    },
    body: await request.arrayBuffer(),
  });

  const body = await upstream.json().catch(() => ({ code: 'INTERNAL' }));
  return NextResponse.json(body, { status: upstream.status });
}
