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

const editButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none';

const cancelButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

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
  const message = isLoading
    ? { text: 'Cargando reservas…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : reservations.length === 0
        ? { text: 'No hay reservas para los filtros seleccionados.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : reservations;

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
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
            {message && (
              <tr>
                <td colSpan={7} className={`px-5 py-10 text-center ${message.tone}`}>
                  {message.text}
                </td>
              </tr>
            )}

            {rows.map((reservation) => (
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
                    <button type="button" onClick={() => onEdit(reservation)} className={editButtonClasses}>
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(reservation)}
                      disabled={reservation.status === 'CANCELLED'}
                      className={cancelButtonClasses}
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

      <div className="lg:hidden">
        {message && <p className={`px-5 py-10 text-center text-sm ${message.tone}`}>{message.text}</p>}

        {rows.length > 0 && (
          <ul className="divide-y divide-goldLight/10">
            {rows.map((reservation) => (
              <li key={reservation.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">{reservation.guestFullName}</p>
                    <p className="text-xs text-textMuted">DNI {reservation.guestDni}</p>
                  </div>
                  <StatusBadge status={reservation.status} />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-textMuted">Habitación</dt>
                    <dd className="truncate text-text">
                      {reservation.room.categoryName} · Hab. {reservation.room.roomNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Origen</dt>
                    <dd className="mt-0.5">
                      <OriginBadge origin={reservation.origin} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Check-in / Check-out</dt>
                    <dd className="text-text">
                      {formatDate(reservation.checkIn)} — {formatDate(reservation.checkOut)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Total / Seña</dt>
                    <dd className="text-text">
                      {formatCurrency(reservation.totalAmount)}
                      <span className="block text-xs text-textMuted">Seña {formatCurrency(reservation.depositAmount)}</span>
                    </dd>
                  </div>
                </dl>

                <div className="flex gap-2">
                  <button type="button" onClick={() => onEdit(reservation)} className={`${editButtonClasses} flex-1 py-2`}>
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancel(reservation)}
                    disabled={reservation.status === 'CANCELLED'}
                    className={`${cancelButtonClasses} flex-1 py-2`}
                  >
                    Cancelar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
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
