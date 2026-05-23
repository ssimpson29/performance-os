'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Trailing sign-out button rendered inside the server AppHeader when
 * a user is signed in. POSTs to /api/auth/signout to clear Supabase
 * session cookies, then routes back to the marketing landing page.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch {
      /* fall through to redirect — middleware will treat as anon */
    }
    router.push('/');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:border-amber-300/60 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
