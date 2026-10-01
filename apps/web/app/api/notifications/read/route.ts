import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

export async function POST(): Promise<NextResponse> {
  await apiFetch('/notifications/read', { method: 'POST' });
  return NextResponse.json({ ok: true });
}
