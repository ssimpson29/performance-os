import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

const { data: countData } = await supabase
  .from('users')
  .select('id', { count: 'exact', head: true });
console.log('public.users row count:', countData);

const { data: rows, error } = await supabase
  .from('users')
  .select('id, email, display_name, created_at')
  .order('created_at', { ascending: false })
  .limit(10);
if (error) throw error;
console.log('Last 10 users (email domains masked):');
for (const r of rows) {
  const [local, domain] = (r.email ?? '').split('@');
  const maskedLocal = local ? local[0] + '***' + local.slice(-1) : '?';
  console.log({ id: r.id, email: `${maskedLocal}@${domain ?? '?'}`, display: r.display_name, created: r.created_at });
}

const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 10 });
console.log('\nauth.users (last 10):');
for (const u of authList?.users ?? []) {
  const [local, domain] = (u.email ?? '').split('@');
  const maskedLocal = local ? local[0] + '***' + local.slice(-1) : '?';
  console.log({ id: u.id, email: `${maskedLocal}@${domain ?? '?'}`, created: u.created_at, last_sign_in: u.last_sign_in_at });
}
