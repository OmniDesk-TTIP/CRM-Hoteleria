import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatActivityRefresh } from '@/hooks/useChatActivityRefresh';
import { getStatistics } from '@/services/statistics.service';
import RangeSelector from '@/components/statistics/RangeSelector';
import StatisticsDashboard from '@/components/statistics/StatisticsDashboard';
import { formatShortDate } from '@/components/dashboard/format';
import { RefreshIcon } from '@/components/layout/icons';
import type { BotStatistics, StatisticsRange } from '@/config/types';

/** US-10: rendimiento del bot. La ruta ya está limitada a ADMIN en App.tsx (CA5). */
export default function StatisticsPage() {
  const [range, setRange] = useState<StatisticsRange>('month');
  const [stats, setStats] = useState<BotStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Si el usuario cambia de período mientras hay un pedido en vuelo, la respuesta vieja llegaría después y pisaría a la nueva: solo vale la del último pedido.
  const lastRequest = useRef(0);

  const fetchStats = useCallback(async () => {
    const requestId = ++lastRequest.current;
    setIsLoading(true);
    setError(null);

    try {
      const data = await getStatistics(range);
      if (requestId !== lastRequest.current) return;

      setStats(data);
      setUpdatedAt(new Date());
    } catch {
      if (requestId !== lastRequest.current) return;
      setError('No se pudieron cargar las métricas. Probá actualizar en un rato.');
    } finally {
      if (requestId === lastRequest.current) setIsLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Un chat nuevo o un cambio de estado mueve los números de derivaciones.
  useChatActivityRefresh(() => void fetchStats());

  // Con otro período seleccionado, los números de antes serían engañosos: no se muestran.
  const current = stats && stats.range === range ? stats : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 border-b border-gold/30 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gold md:text-4xl">Métricas del bot</h1>
          <p className="mt-1 text-sm text-textMuted">
            {current?.from ? `Desde el ${formatShortDate(current.from)}` : current ? 'Todo el historial' : ' '}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <RangeSelector value={range} onChange={setRange} />

          <div className="flex items-center justify-between gap-3 sm:justify-start">
            {updatedAt && (
              <span className="text-xs text-textMuted">
                Actualizado {updatedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              onClick={() => void fetchStats()}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-full bg-gold px-5 py-2 text-sm font-medium text-shell transition hover:bg-goldLight disabled:opacity-60 motion-reduce:transition-none"
            >
              <RefreshIcon className={`h-4 w-4 ${isLoading ? 'motion-safe:animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-dangerText">{error}</p>
      )}

      {!current && !error && <p className="py-16 text-center text-sm text-textMuted">Cargando las métricas…</p>}

      {current && (
        <div className={`transition-opacity motion-reduce:transition-none ${isLoading ? 'opacity-60' : ''}`}>
          <StatisticsDashboard stats={current} />
        </div>
      )}
    </div>
  );
}
