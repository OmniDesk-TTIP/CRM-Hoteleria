import type { SpaReservation } from '@/config/types';
import { SpaReservationStatusBadge } from './Badges';
import { formatCurrency, formatIsoDay } from './spaFormat';

interface SpaReservationsTableProps {
  requests: SpaReservation[];
  isLoading: boolean;
  error: string | null;
  /** Id del turno que se está resolviendo, para deshabilitar sus botones. */
  busyId: string | null;
  onResolve: (request: SpaReservation, status: 'CONFIRMED' | 'REJECTED') => void;
}

const confirmButtonClasses =
  'rounded-full border border-success/40 px-3 py-1.5 text-xs font-medium text-successText transition hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const rejectButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const formatRequestedAt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
    : '—';

const clientLabel = (request: SpaReservation) =>
  request.clientType === 'GUEST' ? 'Huésped' : 'Cliente externo';

/** Los huéspedes no pagan el spa. */
const chargeLabel = (request: SpaReservation) =>
  request.clientType === 'GUEST' ? 'Sin cargo' : formatCurrency(request.amount);

const slotLabel = (request: SpaReservation) => `${formatIsoDay(request.requestedDate)} · ${request.requestedTime}`;

export default function SpaReservationsTable({
  requests,
  isLoading,
  error,
  busyId,
  onResolve,
}: SpaReservationsTableProps) {
  const message = isLoading
    ? { text: 'Cargando turnos…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : requests.length === 0
        ? { text: 'No hay turnos para mostrar.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : requests;

  const renderActions = (request: SpaReservation, fill = false) => {
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
              <th className="px-4 py-3 font-medium sm:px-5">Cliente</th>
              <th className="px-4 py-3 font-medium sm:px-5">Servicio</th>
              <th className="px-4 py-3 font-medium sm:px-5">Turno pedido</th>
              <th className="px-4 py-3 font-medium sm:px-5">Cobro</th>
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
                <td className="px-4 py-3 sm:px-5">
                  <p className="font-medium text-text">{request.guestFullName}</p>
                  <p className="text-xs text-textMuted">{clientLabel(request)}</p>
                </td>
                <td className="px-4 py-3 text-text sm:px-5">{request.serviceName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-text sm:px-5">{slotLabel(request)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">{chargeLabel(request)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">
                  {formatRequestedAt(request.createdAt)}
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <SpaReservationStatusBadge status={request.status} />
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
                    <p className="text-xs text-textMuted">
                      {clientLabel(request)} · {chargeLabel(request)}
                    </p>
                    <p className="truncate text-sm text-text">{request.serviceName}</p>
                  </div>
                  <SpaReservationStatusBadge status={request.status} />
                </div>

                <p className="text-sm text-textMuted">
                  Turno: <span className="text-text">{slotLabel(request)}</span>
                </p>
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
