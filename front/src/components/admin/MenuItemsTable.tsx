import type { MenuItem } from '@/config/types';
import { SpaStatusBadge as MenuItemStatusBadge } from './Badges';
import { formatCurrency } from './spaFormat';

interface MenuItemsTableProps {
  items: MenuItem[];
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  onEdit: (item: MenuItem) => void;
  onToggleStatus: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
}

const editButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none';

const toggleButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-textMuted transition hover:bg-goldLight/10 hover:text-text motion-reduce:transition-none';

const deleteButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 motion-reduce:transition-none';

export default function MenuItemsTable({
  items,
  isLoading,
  error,
  isAdmin,
  onEdit,
  onToggleStatus,
  onDelete,
}: MenuItemsTableProps) {
  const message = isLoading
    ? { text: 'Cargando la carta…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : items.length === 0
        ? { text: 'Todavía no hay platos cargados en la carta.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : items;

  const renderActions = (item: MenuItem, fill = false) => {
    const size = fill ? ' flex-1 py-2' : '';

    return (
      <>
        <button type="button" onClick={() => onEdit(item)} className={`${editButtonClasses}${size}`}>
          Editar
        </button>
        <button type="button" onClick={() => onToggleStatus(item)} className={`${toggleButtonClasses}${size}`}>
          {item.status === 'ACTIVE' ? 'Deshabilitar' : 'Habilitar'}
        </button>
        <button type="button" onClick={() => onDelete(item)} className={`${deleteButtonClasses}${size}`}>
          Eliminar
        </button>
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
              <th className="px-4 py-3 font-medium sm:px-5">Plato</th>
              <th className="px-4 py-3 font-medium sm:px-5">Sección</th>
              <th className="px-4 py-3 font-medium sm:px-5">Precio</th>
              <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
              {isAdmin && <th className="px-4 py-3 text-right font-medium sm:px-5">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-goldLight/10">
            {message && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className={`px-5 py-10 text-center ${message.tone}`}>
                  {message.text}
                </td>
              </tr>
            )}

            {rows.map((item) => (
              <tr key={item.id} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="max-w-xs px-4 py-3 sm:px-5">
                  <p className="font-medium text-text">{item.name}</p>
                  {item.description && <p className="line-clamp-2 text-xs text-textMuted">{item.description}</p>}
                </td>
                <td className="px-4 py-3 text-textMuted sm:px-5">{item.category}</td>
                <td className="whitespace-nowrap px-4 py-3 text-text sm:px-5">{formatCurrency(item.price)}</td>
                <td className="px-4 py-3 sm:px-5">
                  <MenuItemStatusBadge status={item.status} />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex justify-end gap-2">{renderActions(item)}</div>
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
            {rows.map((item) => (
              <li key={item.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{item.name}</p>
                    <p className="text-xs text-textMuted">
                      {item.category} · <span className="text-text">{formatCurrency(item.price)}</span>
                    </p>
                    {item.description && <p className="line-clamp-2 text-sm text-textMuted">{item.description}</p>}
                  </div>
                  <MenuItemStatusBadge status={item.status} />
                </div>

                {isAdmin && <div className="flex gap-2">{renderActions(item, true)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
