import { Link } from 'react-router-dom';
import DashboardCard from '@/components/dashboard/DashboardCard';
import {
  formatDayOfMonth,
  formatPct,
  formatShortDate,
  formatWeekdayInitial,
} from '@/components/dashboard/format';
import type { DashboardOccupancy, OccupancyCellState } from '@/config/types';

const CELL_LABEL: Record<OccupancyCellState, string> = {
  booked: 'Confirmada',
  pending: 'Pendiente de pago',
  free: 'Libre',
  maintenance: 'En mantenimiento',
};

const CELL_CLASSES: Record<OccupancyCellState, string> = {
  booked: 'bg-gold',
  pending:
    'bg-gold/25 bg-[repeating-linear-gradient(45deg,var(--color-gold)_0_2px,transparent_2px_6px)]',
  free: 'bg-surface',
  maintenance: 'bg-danger/35',
};

const LEGEND: OccupancyCellState[] = ['booked', 'pending', 'free', 'maintenance'];

/** Habitaciones × próximos 14 días: qué noche está vendida, reservada sin pagar o libre. */
export default function OccupancyHeatmap({ occupancy }: { occupancy: DashboardOccupancy }) {
  const { days, rooms, occupancyPct } = occupancy;

  return (
    <DashboardCard
      title="Ocupación · próximos 14 días"
      action={
        <Link to="/admin/rooms" className="text-sm text-goldLight underline-offset-2 hover:underline">
          Habitaciones
        </Link>
      }
    >
      {rooms.length === 0 ? (
        <p className="py-8 text-center text-sm text-textMuted">Todavía no hay habitaciones cargadas.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <caption className="sr-only">
              Estado de cada habitación por noche, desde {formatShortDate(days[0])}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-card pr-2 text-left font-normal text-textMuted">
                  Hab.
                </th>
                {days.map((day, index) => (
                  <th
                    key={day}
                    scope="col"
                    className={`min-w-6 font-normal leading-tight ${index === 0 ? 'text-gold' : 'text-textMuted'}`}
                  >
                    <span className="block capitalize">{formatWeekdayInitial(day)}</span>
                    <span className="block tabular-nums">{formatDayOfMonth(day)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id}>
                  <th
                    scope="row"
                    title={room.categoryName}
                    className="sticky left-0 bg-card pr-2 text-left font-medium text-text tabular-nums"
                  >
                    {room.roomNumber}
                  </th>
                  {room.cells.map((state, index) => {
                    const label = `Hab. ${room.roomNumber} · ${formatShortDate(days[index])}: ${CELL_LABEL[state]}`;
                    return (
                      <td key={days[index]} className="p-0">
                        <div
                          title={label}
                          aria-label={label}
                          className={`h-6 rounded-[4px] transition hover:ring-2 hover:ring-goldLight motion-reduce:transition-none ${CELL_CLASSES[state]}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-textMuted">
        {LEGEND.map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[3px] ${CELL_CLASSES[state]}`} aria-hidden />
            {CELL_LABEL[state]}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <div
          className="h-2 overflow-hidden rounded-full bg-surface"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={occupancyPct}
          aria-label="Ocupación de los próximos 14 días"
        >
          <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(occupancyPct, 100)}%` }} />
        </div>
        <p className="mt-2 text-sm text-textMuted">
          Ocupación: <span className="font-semibold text-goldLight">{formatPct(occupancyPct)}</span>
          <span className="ml-1">de las noches disponibles</span>
        </p>
      </div>
    </DashboardCard>
  );
}
