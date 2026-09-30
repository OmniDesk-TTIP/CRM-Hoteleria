import type { AdminReservation, ReservationListFilters, ReservationSortBy } from '@/config/types';
import { OriginBadge, StatusBadge } from './Badges';

interface ReservationsTableProps {
  reservations: AdminReservation[];
  isLoading: boolean;
  error: string | null;
  sortBy: ReservationSortBy;
  sortDir: ReservationListFilters['sortDir'];
  onSortChange: (sortBy: ReservationSortBy) => void;
  onEdit: (reservation: AdminReservation) => void;
  onCancel: (reservation: AdminReservation) => void;
}

const formatDate = (iso: string) => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));

/** Tabla principal de reservas, con orden por columna y acciones (CA1, CA4). */
export default function ReservationsTable({
  reservations,
  isLoading,
  error,
  sortBy,
  sortDir,
  onSortChange,
  onEdit,
  onCancel,
}: ReservationsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
            <th className="px-4 py-3 font-medium sm:px-5">Huésped</th>
            <th className="px-4 py-3 font-medium sm:px-5">Habitación</th>
            <SortableHeader label="Check-in / Check-out" column="checkIn" active={sortBy} dir={sortDir} onSortChange={onSortChange} />
            <SortableHeader label="Estado" column="status" active={sortBy} dir={sortDir} onSortChange={onSortChange} />
            <th className="px-4 py-3 font-medium sm:px-5">Origen</th>
            <th className="px-4 py-3 font-medium sm:px-5">Total / Seña</th>
            <th className="px-4 py-3 font-medium sm:px-5 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-goldLight/10">
          {isLoading && (
            <tr>
              <td colSpan={7} className="px-5 py-10 text-center text-textMuted">
                Cargando reservas…
              </td>
            </tr>
          )}

          {!isLoading && error && (
            <tr>
              <td colSpan={7} className="px-5 py-10 text-center text-dangerText">
                {error}
              </td>
            </tr>
          )}

          {!isLoading && !error && reservations.length === 0 && (
            <tr>
              <td colSpan={7} className="px-5 py-10 text-center text-textMuted">
                No hay reservas para los filtros seleccionados.
              </td>
            </tr>
          )}

          {!isLoading &&
            !error &&
            reservations.map((reservation) => (
              <tr key={reservation.id} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="px-4 py-3 sm:px-5">
                  <p className="font-medium text-text">{reservation.guestFullName}</p>
                  <p className="text-xs text-textMuted">{reservation.guestDni}</p>
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <p className="text-text">{reservation.room.categoryName}</p>
                  <p className="text-xs text-textMuted">Hab. {reservation.room.roomNumber}</p>
                </td>
                <td className="px-4 py-3 sm:px-5 whitespace-nowrap">
                  {formatDate(reservation.checkIn)} — {formatDate(reservation.checkOut)}
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <StatusBadge status={reservation.status} />
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <OriginBadge origin={reservation.origin} />
                </td>
                <td className="px-4 py-3 sm:px-5 whitespace-nowrap">
                  <p className="text-text">{formatCurrency(reservation.totalAmount)}</p>
                  <p className="text-xs text-textMuted">Seña {formatCurrency(reservation.depositAmount)}</p>
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(reservation)}
                      className="rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(reservation)}
                      disabled={reservation.status === 'CANCELLED'}
                      className="rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  column,
  active,
  dir,
  onSortChange,
}: {
  label: string;
  column: ReservationSortBy;
  active: ReservationSortBy;
  dir: ReservationListFilters['sortDir'];
  onSortChange: (column: ReservationSortBy) => void;
}) {
  const isActive = active === column;

  return (
    <th className="px-4 py-3 font-medium sm:px-5">
      <button
        type="button"
        onClick={() => onSortChange(column)}
        className="inline-flex items-center gap-1 uppercase tracking-wide text-textMuted transition hover:text-goldLight motion-reduce:transition-none"
      >
        {label}
        {isActive && <span aria-hidden>{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}
