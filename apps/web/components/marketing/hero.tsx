import Link from 'next/link';
import { Activity, HeartPulse, MoonStar, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const pillars = [
  {
    icon: Activity,
    title: 'Programming that adapts',
    body: 'Ongoing training plans stay grounded in the coach intent while daily readiness shapes execution.',
  },
  {
    icon: MoonStar,
    title: 'Recovery intelligence',
    body: 'Apple Health and Oura patterns become decision support, not just passive charts.',
  },
  {
    icon: HeartPulse,
    title: 'Longevity in context',
    body: 'Blood work and biomarker reviews sit beside training load so recommendations remain coherent.',
  },
  {
    icon: Sparkles,
    title: 'A premium coaching layer',
    body: 'Every screen aims to answer what matters today, what is changing, and what to do next.',
  },
];

export function Hero() {
  return (
    <section className="shell pt-8 pb-14 sm:pt-12 sm:pb-20">
      <div className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div className="space-y-6">
          <Badge>Premium fitness coach + longevity copilot</Badge>
          <div className="space-y-4">
            <p className="eyebrow">Performance OS</p>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
              One system for training progression, recovery signals, and long-horizon health.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted">
              This starter scaffold frames the product as a personal performance operating system — not just a dashboard —
              with elegant surfaces for today&apos;s execution, coach-led plans, and longevity insight.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/today"><Button>Open app scaffold</Button></Link>
            <Link href="/docs"><Button variant="secondary">Read architecture in repo docs</Button></Link>
          </div>
        </div>
        <div className="panel grid gap-4 p-6">
          {pillars.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
              <Icon className="mb-3 h-5 w-5 text-brand2" />
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
