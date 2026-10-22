import type { RestaurantReservation } from '@/config/types';
import { RestaurantReservationStatusBadge } from './Badges';
import { formatIsoDay } from './spaFormat';

interface RestaurantReservationsTableProps {
  requests: RestaurantReservation[];
  isLoading: boolean;
  error: string | null;
  busyId: string | null;
  onResolve: (request: RestaurantReservation, status: 'CONFIRMED' | 'REJECTED') => void;
}

const confirmButtonClasses =
  'rounded-full border border-success/40 px-3 py-1.5 text-xs font-medium text-successText transition hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const rejectButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const formatRequestedAt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
    : '—';

const slotLabel = (request: RestaurantReservation) =>
  `${formatIsoDay(request.requestedDate)} · ${request.requestedTime}`;

const peopleLabel = (request: RestaurantReservation) =>
  request.partySize === 1 ? '1 persona' : `${request.partySize} personas`;

export default function RestaurantReservationsTable({
  requests,
  isLoading,
  error,
  busyId,
  onResolve,
}: RestaurantReservationsTableProps) {
  const message = isLoading
    ? { text: 'Cargando pedidos…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : requests.length === 0
        ? { text: 'No hay pedidos de mesa para mostrar.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : requests;

  const renderActions = (request: RestaurantReservation, fill = false) => {
    if (request.status !== 'PENDING') return null;
    const size = fill ? ' flex-1 py-2' : '';
    const busy = busyId === request.id;

    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(request, 'CONFIRMED')}
          className={`${confirmButtonClasses}${size}`}
        >
          Confirmar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(request, 'REJECTED')}
          className={`${rejectButtonClasses}${size}`}
        >
          Rechazar
        </button>
      </>
    );
  };

  return (
    <>
      {/* Tabla: pantallas anchas */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium sm:px-5">Huésped</th>
              <th className="px-4 py-3 font-medium sm:px-5">Mesa pedida</th>
              <th className="px-4 py-3 font-medium sm:px-5">Personas</th>
              <th className="px-4 py-3 font-medium sm:px-5">Comentario</th>
              <th className="px-4 py-3 font-medium sm:px-5">Solicitada</th>
              <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Acciones</th>
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

            {rows.map((request) => (
              <tr key={request.id} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="px-4 py-3 font-medium text-text sm:px-5">{request.guestFullName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-text sm:px-5">{slotLabel(request)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">{request.partySize}</td>
                <td className="min-w-[10rem] max-w-xs px-4 py-3 text-textMuted sm:px-5">{request.notes ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">
                  {formatRequestedAt(request.createdAt)}
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <RestaurantReservationStatusBadge status={request.status} />
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <div className="flex justify-end gap-2">{renderActions(request)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas: celular y tablet */}
      <div className="lg:hidden">
        {message && <p className={`px-5 py-10 text-center text-sm ${message.tone}`}>{message.text}</p>}

        {rows.length > 0 && (
          <ul className="divide-y divide-goldLight/10">
            {rows.map((request) => (
              <li key={request.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{request.guestFullName}</p>
                    <p className="text-sm text-text">
                      {slotLabel(request)} · {peopleLabel(request)}
                    </p>
                  </div>
                  <RestaurantReservationStatusBadge status={request.status} />
                </div>

                {request.notes && <p className="text-sm text-textMuted">“{request.notes}”</p>}
                <p className="text-xs text-textMuted">Solicitada el {formatRequestedAt(request.createdAt)}</p>

                {request.status === 'PENDING' && <div className="flex gap-2">{renderActions(request, true)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
