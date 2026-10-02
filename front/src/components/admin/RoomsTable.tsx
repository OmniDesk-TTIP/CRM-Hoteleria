import type { RoomOption } from '@/config/types';
import { RoomStatusBadge } from './Badges';

interface RoomsTableProps {
  rooms: RoomOption[];
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  onEdit: (room: RoomOption) => void;
  onDisable: (room: RoomOption) => void;
  onReactivate: (room: RoomOption) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));

const editButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none';

const reactivateButtonClasses =
  'rounded-full border border-success/40 px-3 py-1.5 text-xs font-medium text-successText transition hover:bg-success/10 motion-reduce:transition-none';

const disableButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 motion-reduce:transition-none';

const capacityLabel = (capacity: number) => `${capacity} ${capacity === 1 ? 'persona' : 'personas'}`;

export default function RoomsTable({ rooms, isLoading, error, isAdmin, onEdit, onDisable, onReactivate }: RoomsTableProps) {
  const message = isLoading
    ? { text: 'Cargando inventario…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : rooms.length === 0
        ? { text: 'Todavía no hay habitaciones cargadas.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : rooms;

  const renderActions = (room: RoomOption, fill = false) => {
    const size = fill ? ' flex-1 py-2' : '';

    return (
      <>
        <button type="button" onClick={() => onEdit(room)} className={`${editButtonClasses}${size}`}>
          Editar
        </button>
        {room.status === 'INACTIVE' ? (
          <button type="button" onClick={() => onReactivate(room)} className={`${reactivateButtonClasses}${size}`}>
            Reactivar
          </button>
        ) : (
          <button type="button" onClick={() => onDisable(room)} className={`${disableButtonClasses}${size}`}>
            Deshabilitar
          </button>
        )}
      </>
    );
  };

  return (
    <>
      {/* Tabla: pantallas anchas */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium sm:px-5">Habitación</th>
              <th className="px-4 py-3 font-medium sm:px-5">Tipo</th>
              <th className="px-4 py-3 font-medium sm:px-5">Capacidad</th>
              <th className="px-4 py-3 font-medium sm:px-5">Precio base</th>
              <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
              {isAdmin && <th className="px-4 py-3 font-medium sm:px-5 text-right">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-goldLight/10">
            {message && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className={`px-5 py-10 text-center ${message.tone}`}>
                  {message.text}
                </td>
              </tr>
            )}

            {rows.map((room) => (
              <tr key={room.id} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="px-4 py-3 sm:px-5 font-medium text-text">Hab. {room.roomNumber}</td>
                <td className="px-4 py-3 sm:px-5 text-text">{room.categoryName}</td>
                <td className="px-4 py-3 sm:px-5 text-textMuted">{capacityLabel(room.capacity)}</td>
                <td className="px-4 py-3 sm:px-5 whitespace-nowrap text-text">{formatCurrency(room.basePrice)}</td>
                <td className="px-4 py-3 sm:px-5">
                  <RoomStatusBadge status={room.status} />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex justify-end gap-2">{renderActions(room)}</div>
                  </td>
                )}
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
            {rows.map((room) => (
              <li key={room.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">Hab. {room.roomNumber}</p>
                    <p className="truncate text-sm text-text">{room.categoryName}</p>
                  </div>
                  <RoomStatusBadge status={room.status} />
                </div>

                <p className="text-sm text-textMuted">
                  {capacityLabel(room.capacity)} · <span className="text-text">{formatCurrency(room.basePrice)}</span>
                </p>

                {isAdmin && <div className="flex gap-2">{renderActions(room, true)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
