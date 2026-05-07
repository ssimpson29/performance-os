import { cn } from '@/lib/utils';

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-brand2/20 bg-brand2/10 px-3 py-1 text-xs font-medium text-brand2',
        className,
      )}
    >
      {children}
    </span>
  );
}
