import { useCallback, useEffect, useState } from 'react';
import {
  changeRestaurantReservationStatus,
  listRestaurantReservations,
} from '@/services/restaurantReservation.service';
import type {
  RestaurantReservation,
  RestaurantReservationListFilters,
  RestaurantReservationStatus,
} from '@/config/types';
import RestaurantReservationsTable from '@/components/admin/RestaurantReservationsTable';
import Pagination from '@/components/admin/Pagination';
import { useLayoutContext } from '@/components/layout/layout.context';

const PAGE_SIZE = 10;

const STATUS_FILTERS: { value: RestaurantReservationStatus | 'ALL'; label: string }[] = [
  { value: 'PENDING', label: 'Pendientes de confirmar' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'REJECTED', label: 'Rechazadas' },
  { value: 'ALL', label: 'Todas' },
];

const inputClasses =
  'rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export default function RestaurantReservationsPage() {
  const { refreshPendingRestaurantReservations } = useLayoutContext();
  const [filters, setFilters] = useState<RestaurantReservationListFilters>({
    status: 'ALL',
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [requests, setRequests] = useState<RestaurantReservation[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listRestaurantReservations(filters);
      setRequests(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar los pedidos de mesa.'));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleResolve = async (request: RestaurantReservation, status: 'CONFIRMED' | 'REJECTED') => {
    setActionError(null);
    setBusyId(request.id);
    try {
      await changeRestaurantReservationStatus(request.id, status);
      await fetchRequests();
      refreshPendingRestaurantReservations();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'No se pudo actualizar el pedido.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Mesas del restaurante</h1>
          <p className="text-sm text-textMuted">Pedidos de mesa que los huéspedes hacen por el chat.</p>
        </div>

        <label className="flex w-full flex-col gap-1 text-sm text-textMuted sm:w-auto">
          Estado
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                status: e.target.value as RestaurantReservationListFilters['status'],
                page: 1,
              }))
            }
            className={inputClasses}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {actionError}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <RestaurantReservationsTable
          requests={requests}
          isLoading={isLoading}
          error={error}
          busyId={busyId}
          onResolve={handleResolve}
        />
        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
        />
      </div>
    </div>
  );
}
