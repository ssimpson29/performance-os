import { Badge } from '@/components/ui/badge';

export function PageHero({
  eyebrow,
  title,
  description,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <section className="shell py-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-4">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
          <p className="text-lg leading-8 text-muted">{description}</p>
        </div>
        {badge ? <Badge className="self-start lg:self-auto">{badge}</Badge> : null}
      </div>
    </section>
  );
}
