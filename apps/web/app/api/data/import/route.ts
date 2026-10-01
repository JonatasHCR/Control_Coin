import { NextResponse } from 'next/server';

import { apiFetch, ApiError } from '@/lib/api';

/** Proxy so the client import form never holds the session token. */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  try {
    return NextResponse.json(
      await apiFetch('/data/import', { method: 'POST', body: JSON.stringify(body) }),
    );
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(
      { code: error instanceof ApiError ? error.code : 'INTERNAL' },
      { status },
    );
  }
}
