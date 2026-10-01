import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

/** Proxy so the client popover reads notifications without holding the token. */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await apiFetch('/notifications'));
  } catch {
    return NextResponse.json({ unread: 0, items: [] });
  }
}
