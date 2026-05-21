import { NextResponse } from 'next/server';

import { syncOuraRecovery, OuraRecoverySyncError } from '@/lib/oura/recovery-sync';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    startDate?: string;
    endDate?: string;
  };

  try {
    const supabase = createServerSupabaseClient();
    const result = await syncOuraRecovery(supabase, {
      userId,
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
