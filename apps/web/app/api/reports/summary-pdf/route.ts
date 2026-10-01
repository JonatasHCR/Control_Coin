import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/lib/api';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').trim().replace(/\/+$/, '');

/** Streams the PDF summary (a month or a date range) the API generates, as a download. */
export async function GET(request: Request): Promise<Response> {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ['period', 'from', 'to']) {
    const value = incoming.get(key);
    if (value) query.set(key, value);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const upstream = await fetch(`${BASE}/reports/summary.pdf?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => ({}))) as { detail?: { message?: string } };
    const message = body.detail?.message ?? 'não foi possível gerar o PDF';
    return new Response(`Erro: ${message}`, { status: upstream.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        upstream.headers.get('content-disposition') ?? 'attachment; filename="control-coin-resumo.pdf"',
    },
  });
}
