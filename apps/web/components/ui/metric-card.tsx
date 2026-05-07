import { ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatTrend } from '@/lib/utils';
import type { MetricCard as MetricCardType } from '@/lib/sample-data';

export function MetricCard({ label, value, trend, tone = 'default' }: MetricCardType) {
  const Icon = typeof trend === 'number' ? (trend >= 0 ? TrendingUp : TrendingDown) : ArrowUpRight;

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
        </div>
        <div
          className={[
            'rounded-full p-2',
            tone === 'good' && 'bg-brand/15 text-brand',
            tone === 'caution' && 'bg-warning/15 text-warning',
            tone === 'default' && 'bg-white/10 text-white',
          ].join(' ')}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {typeof trend === 'number' ? (
        <p className="text-sm text-muted">vs prior week <span className="text-white">{formatTrend(trend)}</span></p>
      ) : (
        <p className="text-sm text-muted">Connected data is summarized into simple coaching signals.</p>
      )}
    </Card>
  );
}
