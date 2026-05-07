import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTrend(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}%`;
}
