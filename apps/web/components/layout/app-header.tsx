import Link from 'next/link';
import { appConfig } from '@/lib/site';
import { cn } from '@/lib/utils';

export function AppHeader({ currentPath }: { currentPath?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/80 backdrop-blur">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">PO</span>
          <span>{appConfig.name}</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {appConfig.navigation.map((item) => {
            const active = currentPath?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition',
                  active ? 'bg-white/10 text-white' : 'text-muted hover:text-white',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
