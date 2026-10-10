import type { SpaService } from '@/config/types';
import { SpaStatusBadge } from './Badges';
import { describeWeekdays, formatCurrency } from './spaFormat';

interface SpaServicesTableProps {
  services: SpaService[];
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  onEdit: (service: SpaService) => void;
  onDisable: (service: SpaService) => void;
  onReactivate: (service: SpaService) => void;
}

const editButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none';

const reactivateButtonClasses =
  'rounded-full border border-success/40 px-3 py-1.5 text-xs font-medium text-successText transition hover:bg-success/10 motion-reduce:transition-none';

const disableButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 motion-reduce:transition-none';

const scheduleLabel = (service: SpaService) =>
  `${describeWeekdays(service.availableWeekdays)} · ${service.opensAt} a ${service.closesAt}`;

export default function SpaServicesTable({
  services,
  isLoading,
  error,
  isAdmin,
  onEdit,
  onDisable,
  onReactivate,
}: SpaServicesTableProps) {
  const message = isLoading
    ? { text: 'Cargando servicios…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : services.length === 0
        ? { text: 'Todavía no hay servicios de spa cargados.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : services;

  const renderActions = (service: SpaService, fill = false) => {
    const size = fill ? ' flex-1 py-2' : '';

    return (
      <>
        <button type="button" onClick={() => onEdit(service)} className={`${editButtonClasses}${size}`}>
          Editar
        </button>
        {service.status === 'INACTIVE' ? (
          <button type="button" onClick={() => onReactivate(service)} className={`${reactivateButtonClasses}${size}`}>
            Reactivar
          </button>
        ) : (
          <button type="button" onClick={() => onDisable(service)} className={`${disableButtonClasses}${size}`}>
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
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium sm:px-5">Servicio</th>
              <th className="px-4 py-3 font-medium sm:px-5">Duración</th>
              <th className="px-4 py-3 font-medium sm:px-5">Precio (externos)</th>
              <th className="px-4 py-3 font-medium sm:px-5">Turnos a la vez</th>
              <th className="px-4 py-3 font-medium sm:px-5">Disponibilidad</th>
              <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
              {isAdmin && <th className="px-4 py-3 text-right font-medium sm:px-5">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-goldLight/10">
            {message && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className={`px-5 py-10 text-center ${message.tone}`}>
                  {message.text}
                </td>
              </tr>
            )}

            {rows.map((service) => (
              <tr key={service.id} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="max-w-xs px-4 py-3 sm:px-5">
                  <p className="font-medium text-text">{service.name}</p>
                  <p className="line-clamp-2 text-xs text-textMuted">{service.description}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">{service.durationMinutes} min</td>
                <td className="whitespace-nowrap px-4 py-3 text-text sm:px-5">{formatCurrency(service.price)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">{service.capacity}</td>
                <td className="px-4 py-3 text-textMuted sm:px-5">{scheduleLabel(service)}</td>
                <td className="px-4 py-3 sm:px-5">
                  <SpaStatusBadge status={service.status} />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex justify-end gap-2">{renderActions(service)}</div>
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
            {rows.map((service) => (
              <li key={service.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{service.name}</p>
                    <p className="line-clamp-2 text-sm text-textMuted">{service.description}</p>
                  </div>
                  <SpaStatusBadge status={service.status} />
                </div>

                <p className="text-sm text-textMuted">
                  {service.durationMinutes} min · <span className="text-text">{formatCurrency(service.price)}</span> ·{' '}
                  {service.capacity} {service.capacity === 1 ? 'turno a la vez' : 'turnos a la vez'}
                </p>
                <p className="text-sm text-textMuted">{scheduleLabel(service)}</p>

                {isAdmin && <div className="flex gap-2">{renderActions(service, true)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
