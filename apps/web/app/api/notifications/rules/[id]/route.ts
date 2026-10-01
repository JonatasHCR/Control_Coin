import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

async function forward(request: Request, id: string, body?: string): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${BASE}/notifications/rules/${id}`, {
    method: request.method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
    cache: 'no-store',
  });
  const text = await upstream.text();
  return new NextResponse(text || '{}', {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Update an alert rule — threshold, days-before or active. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return forward(request, (await ctx.params).id, await request.text());
}

/** Remove an alert rule. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return forward(request, (await ctx.params).id);
}
