import { NextResponse } from 'next/server';

import { syncOuraRecovery, OuraRecoverySyncError } from '@/lib/oura/recovery-sync';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    userId?: string;
    startDate?: string;
    endDate?: string;
  };

  if (!body.userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const supabase = createServerSupabaseClient();
    const result = await syncOuraRecovery(supabase, {
      userId: body.userId,
      startDate: body.startDate,
      endDate: body.endDate,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OuraRecoverySyncError) {
      return NextResponse.json(
        {
          ok: false,
          provider: 'oura',
          error: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        provider: 'oura',
        error: error instanceof Error ? error.message : 'Unknown Oura sync error.',
      },
      { status: 500 },
    );
  }
}
