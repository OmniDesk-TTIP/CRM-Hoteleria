import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listReservations, cancelReservation } from '@/services/reservation.service';
import type { AdminReservation, ReservationListFilters, ReservationSortBy, ReservationStatus } from '@/config/types';
import ReservationsTable from '@/components/admin/ReservationsTable';
import ReservationFilters from '@/components/admin/ReservationFilters';
import Pagination from '@/components/admin/Pagination';
import ReservationFormModal from '@/components/admin/ReservationFormModal';
import ConfirmCancelModal from '@/components/admin/ConfirmCancelModal';

const RESERVATION_STATUSES: ReservationStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'];
const SORT_COLUMNS: ReservationSortBy[] = ['checkIn', 'createdAt', 'status'];

const filtersFromParams = (params: URLSearchParams): ReservationListFilters => {
  const status = params.get('status') as ReservationStatus | null;
  const sortBy = params.get('sortBy') as ReservationSortBy | null;
  const dateFrom = params.get('dateFrom');

  return {
    page: 1,
    pageSize: 10,
    sortBy: sortBy && SORT_COLUMNS.includes(sortBy) ? sortBy : 'createdAt',
    sortDir: params.get('sortDir') === 'asc' ? 'asc' : 'desc',
    status: status && RESERVATION_STATUSES.includes(status) ? status : 'ALL',
    ...(dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? { dateFrom } : {}),
  };
};

export default function ReservationsPage() {
  const [searchParams] = useSearchParams();
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ReservationListFilters>(() => filtersFromParams(searchParams));

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<AdminReservation | null>(null);
  
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelingReservation, setCancelingReservation] = useState<AdminReservation | null>(null);

  const fetchReservations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listReservations(filters);
      setReservations(result.data);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al cargar las reservas.');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  const handleFilterChange = (patch: Partial<ReservationListFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const handleSortChange = (column: ReservationSortBy) => {
    setFilters((prev) => ({
      ...prev,
      sortBy: column,
      sortDir: prev.sortBy === column && prev.sortDir === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  const handleCreate = () => {
    setEditingReservation(null);
    setFormModalOpen(true);
  };

  const handleEdit = (reservation: AdminReservation) => {
    setEditingReservation(reservation);
    setFormModalOpen(true);
  };

  const handleCancelClick = (reservation: AdminReservation) => {
    setCancelingReservation(reservation);
    setCancelModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancelingReservation) return;
    try {
      await cancelReservation(cancelingReservation.id);
      setCancelModalOpen(false);
      setCancelingReservation(null);
      fetchReservations();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Error al cancelar la reserva.');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Gestión de Reservas</h1>
        </div>
        <button
          onClick={handleCreate}
          className="rounded-xl bg-gold px-4 py-2 font-medium text-background transition hover:bg-goldLight motion-reduce:transition-none"
        >
          + Nueva Reserva
        </button>
      </div>

      <ReservationFilters filters={filters} onChange={handleFilterChange} />

      <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <ReservationsTable
          reservations={reservations}
          isLoading={isLoading}
          error={error}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={handleSortChange}
          onEdit={handleEdit}
          onCancel={handleCancelClick}
        />
        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={handlePageChange}
        />
      </div>

      {formModalOpen && (
        <ReservationFormModal
          reservation={editingReservation}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setFormModalOpen(false);
            fetchReservations();
          }}
        />
      )}

      {cancelModalOpen && cancelingReservation && (
        <ConfirmCancelModal
          reservation={cancelingReservation}
          onClose={() => setCancelModalOpen(false)}
          onConfirm={handleConfirmCancel}
        />
      )}
    </div>
  );
}