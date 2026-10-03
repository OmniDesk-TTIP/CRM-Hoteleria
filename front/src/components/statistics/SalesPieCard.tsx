import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import DashboardCard from '@/components/dashboard/DashboardCard';
import { formatPct } from '@/components/dashboard/format';
import type { BotStatistics } from '@/config/types';

const BOT_COLOR = 'var(--color-gold)';
const MANUAL_COLOR = 'var(--color-textMuted)';

interface TooltipContentProps {
  active?: boolean;
  payload?: { name: string; value: number }[];
}

function SalesTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const [slice] = payload;

  return (
    <div className="rounded-lg border border-gold/40 bg-shell px-3 py-2 text-xs shadow-lg">
      <p className="text-textMuted">{slice.name}</p>
      <p className="mt-0.5 text-sm font-semibold text-text">
        {slice.value} {slice.value === 1 ? 'reserva' : 'reservas'}
      </p>
    </div>
  );
}

export default function SalesPieCard({ sales }: { sales: BotStatistics['sales'] }) {
  const slices = [
    { name: 'Bot', value: sales.bot, pct: sales.botPct, color: BOT_COLOR },
    { name: 'Manual', value: sales.manual, pct: sales.manualPct, color: MANUAL_COLOR },
  ];

  return (
    <DashboardCard title="Reservas: Bot vs Manual">
      {sales.total === 0 ? (
        <p className="flex h-64 items-center justify-center text-center text-sm text-textMuted">
          Todavía no hay reservas confirmadas en este período.
        </p>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-6 sm:flex-row sm:justify-center">
          <div className="relative h-56 w-56 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="100%"
                  paddingAngle={sales.bot > 0 && sales.manual > 0 ? 2 : 0}
                  stroke="var(--color-card)"
                  strokeWidth={2}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip content={<SalesTooltip />} />
              </PieChart>
            </ResponsiveContainer>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-text">{formatPct(sales.botPct)}</span>
              <span className="text-xs text-textMuted">cerradas por el bot</span>
            </div>
          </div>

          <ul className="w-full max-w-xs space-y-3 sm:w-auto">
            {slices.map((slice) => (
              <li key={slice.name} className="flex items-center gap-3">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden />
                <span className="text-sm text-text">{slice.name}</span>
                <span className="ml-auto pl-4 text-sm text-textMuted">
                  <span className="font-semibold text-text">{slice.value}</span> · {formatPct(slice.pct)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}
