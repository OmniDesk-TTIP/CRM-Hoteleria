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

export default function RoomsTable({ rooms, isLoading, error, isAdmin, onEdit, onDisable, onReactivate }: RoomsTableProps) {
  return (
    <div className="overflow-x-auto">
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
          {isLoading && (
            <tr>
              <td colSpan={isAdmin ? 6 : 5} className="px-5 py-10 text-center text-textMuted">
                Cargando inventario…
              </td>
            </tr>
          )}

          {!isLoading && error && (
            <tr>
              <td colSpan={isAdmin ? 6 : 5} className="px-5 py-10 text-center text-dangerText">
                {error}
              </td>
            </tr>
          )}

          {!isLoading && !error && rooms.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 6 : 5} className="px-5 py-10 text-center text-textMuted">
                Todavía no hay habitaciones cargadas.
              </td>
            </tr>
          )}

          {!isLoading &&
            !error &&
            rooms.map((room) => (
              <tr key={room.id} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="px-4 py-3 sm:px-5 font-medium text-text">Hab. {room.roomNumber}</td>
                <td className="px-4 py-3 sm:px-5 text-text">{room.categoryName}</td>
                <td className="px-4 py-3 sm:px-5 text-textMuted">
                  {room.capacity} {room.capacity === 1 ? 'persona' : 'personas'}
                </td>
                <td className="px-4 py-3 sm:px-5 whitespace-nowrap text-text">{formatCurrency(room.basePrice)}</td>
                <td className="px-4 py-3 sm:px-5">
                  <RoomStatusBadge status={room.status} />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(room)}
                        className="rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none"
                      >
                        Editar
                      </button>
                      {room.status === 'INACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => onReactivate(room)}
                          className="rounded-full border border-success/40 px-3 py-1.5 text-xs font-medium text-successText transition hover:bg-success/10 motion-reduce:transition-none"
                        >
                          Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDisable(room)}
                          className="rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 motion-reduce:transition-none"
                        >
                          Deshabilitar
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
