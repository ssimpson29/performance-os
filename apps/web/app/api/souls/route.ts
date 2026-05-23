import { NextResponse } from 'next/server';

import { updateSoul } from '@/lib/profile/soul-writer';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * PATCH /api/souls — auth-scoped update for one athlete soul.
 *
 * Body: { kind: 'training' | 'longevity', content: string }.
 * Always writes with updated_by = 'athlete' — LLM-driven writes go
 * through the coach tool path, which has its own attribution.
 *
 * Idempotency lives in the writer: identical-content writes don't
 * produce an audit row.
 */
export async function PATCH(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object.' }, { status: 400 });
  }

  const { kind, content } = body as { kind?: unknown; content?: unknown };
  if (kind !== 'training' && kind !== 'longevity') {
    return NextResponse.json(
      { error: "kind must be 'training' or 'longevity'." },
      { status: 400 },
    );
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string.' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  try {
    const soul = await updateSoul(supabase, {
      userId,
      kind,
      content,
      updatedBy: 'athlete',
    });
    return NextResponse.json({ ok: true, soul });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
