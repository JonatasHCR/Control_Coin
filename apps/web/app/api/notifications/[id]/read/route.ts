import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
  return NextResponse.json({ ok: true });
}
