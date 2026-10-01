import { NextResponse } from 'next/server';

import { apiFetch, ApiError } from '@/lib/api';

/**
 * A thin proxy so the client component can pay without holding the session
 * token — it stays httpOnly on the server. This is the one deliberate use of
 * app/api: it forwards to the single Nest API, it does not implement anything.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json();

  try {
    const result = await apiFetch(`/invoices/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : 'INTERNAL';
    return NextResponse.json({ code }, { status });
  }
}
