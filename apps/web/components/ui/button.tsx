import * as React from 'react';
import { cn } from '@/lib/utils';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({ className, variant = 'primary', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-brand2/70 focus:ring-offset-2 focus:ring-offset-slate-950',
        variant === 'primary' && 'bg-brand text-slate-950 hover:bg-brand/90',
        variant === 'secondary' && 'border border-line bg-white/5 text-white hover:bg-white/10',
        variant === 'ghost' && 'text-muted hover:text-white',
        className,
      )}
      {...props}
    />
  );
}
