import KpiCard from '@/components/statistics/KpiCard';
import SalesPieCard from '@/components/statistics/SalesPieCard';
import MetricsGlossary from '@/components/statistics/MetricsGlossary';
import { TOTAL_RESERVATIONS_LABEL } from '@/components/statistics/ranges';
import { formatCurrency, formatPct } from '@/components/dashboard/format';
import { BotIcon, CalendarIcon, HeadsetIcon, WalletIcon } from '@/components/layout/icons';
import type { BotStatistics } from '@/config/types';

export default function StatisticsDashboard({ stats }: { stats: BotStatistics }) {
  const { sales, revenue, handover } = stats;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ingresos por IA"
          value={formatCurrency(revenue.botDeposits)}
          icon={WalletIcon}
          hint={
            <>
              Señas cobradas por Mercado Pago en reservas del bot. Valor total de esas reservas:{' '}
              <span className="font-medium text-text">{formatCurrency(revenue.botTotalValue)}</span>
            </>
          }
        />

        <KpiCard
          label={TOTAL_RESERVATIONS_LABEL[stats.range]}
          value={String(sales.total)}
          icon={CalendarIcon}
          hint={`${sales.bot} del bot · ${sales.manual} manuales`}
        />

        <KpiCard
          label="Bot vs Manual"
          value={`${formatPct(sales.botPct)} bot`}
          icon={BotIcon}
          hint={`${formatPct(sales.manualPct)} manual`}
        />

        <KpiCard
          label="Chats derivados a humanos"
          value={String(handover.handedOver)}
          icon={HeadsetIcon}
          hint={
            handover.totalSessions === 0
              ? 'Todavía no hay conversaciones en este período.'
              : `${formatPct(handover.ratePct)} de ${handover.totalSessions} ${
                  handover.totalSessions === 1 ? 'conversación' : 'conversaciones'
                }`
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 *:min-w-0 *:flex-1">
          <SalesPieCard sales={sales} />
        </div>
        <div className="flex min-w-0 *:min-w-0 *:flex-1">
          <MetricsGlossary />
        </div>
      </div>
    </div>
  );
}
