import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth.context';
import { useChatActivityRefresh } from '@/hooks/useChatActivityRefresh';
import { getDashboardSummary } from '@/services/dashboard.service';
import AttentionCard from '@/components/dashboard/AttentionCard';
import OccupancyHeatmap from '@/components/dashboard/OccupancyHeatmap';
import UpcomingReservations from '@/components/dashboard/UpcomingReservations';
import RevenueCard from '@/components/dashboard/RevenueCard';
import { formatLongDate } from '@/components/dashboard/format';
import { RefreshIcon } from '@/components/layout/icons';
import type { DashboardSummary } from '@/config/types';

export default function HomePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSummary(await getDashboardSummary());
      setUpdatedAt(new Date());
    } catch {
      setError('No se pudo cargar el resumen. Probá actualizar en un rato.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useChatActivityRefresh(() => void fetchSummary());

  const firstName = user?.fullName.split(' ')[0] ?? '';

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 border-b border-gold/30 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gold md:text-4xl">Hola{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mt-1 text-sm capitalize text-textMuted">
            {summary ? formatLongDate(summary.today) : ' '}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="text-xs text-textMuted">
              Actualizado {updatedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchSummary()}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-full bg-gold px-5 py-2 text-sm font-medium text-shell transition hover:bg-goldLight disabled:opacity-60 motion-reduce:transition-none"
          >
            <RefreshIcon className={`h-4 w-4 ${isLoading ? 'motion-safe:animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-dangerText">{error}</p>
      )}

      {!summary && !error && <p className="py-16 text-center text-sm text-textMuted">Cargando el resumen…</p>}

      {summary && (
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="flex min-w-0 *:min-w-0 *:flex-1 xl:col-span-7">
            <AttentionCard attention={summary.attention} today={summary.today} />
          </div>
          <div className="flex min-w-0 *:min-w-0 *:flex-1 xl:col-span-5">
            <OccupancyHeatmap occupancy={summary.occupancy} />
          </div>
          <div className="flex min-w-0 *:min-w-0 *:flex-1 xl:col-span-6">
            <UpcomingReservations reservations={summary.upcomingReservations} today={summary.today} />
          </div>
          <div className="flex min-w-0 *:min-w-0 *:flex-1 xl:col-span-6">
            <RevenueCard revenue={summary.revenue} />
          </div>
        </div>
      )}
    </div>
  );
}
