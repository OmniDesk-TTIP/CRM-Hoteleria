import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DashboardCard from '@/components/dashboard/DashboardCard';
import {
  formatCompactCurrency,
  formatCurrency,
  formatMonth,
  formatPct,
} from '@/components/dashboard/format';
import type { DashboardRevenue } from '@/config/types';

const GOLD = 'var(--color-gold)';
const MUTED = 'var(--color-textMuted)';
const GRID = 'color-mix(in srgb, var(--color-goldLight) 12%, transparent)';

interface TooltipContentProps {
  active?: boolean;
  payload?: { value: number; payload: { month: string } }[];
}

function RevenueTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const [point] = payload;

  return (
    <div className="rounded-lg border border-gold/40 bg-shell px-3 py-2 text-xs shadow-lg">
      <p className="capitalize text-textMuted">{formatMonth(point.payload.month, true)}</p>
      <p className="mt-0.5 text-sm font-semibold text-text">{formatCurrency(point.value)}</p>
    </div>
  );
}

/** Ingresos confirmados (por mes de check-in) y los KPIs del mes corriente. */
export default function RevenueCard({ revenue }: { revenue: DashboardRevenue }) {
  const kpis = [
    { label: 'Ingresos del mes', value: formatCurrency(revenue.monthTotal) },
    { label: 'Tarifa promedio / noche', value: formatCurrency(revenue.adr) },
    { label: 'Ocupación del mes', value: formatPct(revenue.monthOccupancyPct) },
  ];

  const hasData = revenue.byMonth.some((point) => point.total > 0);

  return (
    <DashboardCard title="Ingresos">
      <dl className="grid grid-cols-3 divide-x divide-gold/30">
        {kpis.map(({ label, value }) => (
          <div key={label} className="px-3 first:pl-0 last:pr-0">
            <dt className="text-xs text-textMuted md:text-sm">{label}</dt>
            <dd className="mt-1 truncate text-lg font-semibold text-gold md:text-2xl">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 text-xs text-textMuted">Reservas confirmadas de los últimos 12 meses, por mes de llegada</p>

      <div className="mt-2 h-56 flex-1">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenue.byMonth} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GOLD} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(month: string) => formatMonth(month)}
                tick={{ fill: MUTED, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                tickFormatter={(value: number) => formatCompactCurrency(value)}
                tick={{ fill: MUTED, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip
                content={<RevenueTooltip />}
                cursor={{ stroke: 'var(--color-goldLight)', strokeWidth: 1, strokeOpacity: 0.4 }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke={GOLD}
                strokeWidth={2}
                fill="url(#revenueFill)"
                activeDot={{ r: 5, fill: GOLD, stroke: 'var(--color-card)', strokeWidth: 2 }}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-textMuted">
            Todavía no hay reservas confirmadas en este período.
          </p>
        )}
      </div>
    </DashboardCard>
  );
}
