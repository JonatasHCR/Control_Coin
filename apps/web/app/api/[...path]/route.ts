import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/**
 * A generic authenticated proxy to the Nest API for client-driven mutations.
 *
 * The one deliberate use of `app/api` (ARCH06): a client component must not
 * hold the session token — it stays httpOnly on the server — so these thin
 * routes forward the call and nothing else. They implement no logic; the API
 * is the single source of rules. Only methods that mutate are exposed here,
 * and only paths under the API's own surface.
 *
 * The data routes, the invoice-pay route and the notifications routes keep
 * their own dedicated handlers (streaming, multipart); everything else flows
 * through this one.
 */
async function forward(request: Request, path: string[]): Promise<NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const search = new URL(request.url).search;
  const method = request.method;

  const body =
    method === 'GET' || method === 'DELETE' ? undefined : await request.text();

  const upstream = await fetch(`${BASE}/${path.join('/')}${search}`, {
    method,
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

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
