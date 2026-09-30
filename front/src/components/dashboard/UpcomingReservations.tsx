import { Link } from 'react-router-dom';
import DashboardCard from '@/components/dashboard/DashboardCard';
import { OriginBadge, StatusBadge } from '@/components/admin/Badges';
import { ChevronRightIcon } from '@/components/layout/icons';
import { formatShortDate, nightsBetween } from '@/components/dashboard/format';
import type { AdminReservation } from '@/config/types';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export default function UpcomingReservations({ reservations, today }: { reservations: AdminReservation[]; today: string }) {
  return (
    <DashboardCard
      title="Próximos check-ins"
      action={
        <Link
          to={`/admin/reservations?dateFrom=${today}&sortBy=checkIn&sortDir=asc`}
          className="text-sm text-goldLight underline-offset-2 hover:underline"
        >
          Ver todas
        </Link>
      }
    >
      {reservations.length === 0 ? (
        <p className="py-8 text-center text-sm text-textMuted">No hay llegadas próximas.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-goldLight/15 text-left text-textMuted">
                <th scope="col" className="px-2 pb-2 font-normal">Huésped</th>
                <th scope="col" className="px-2 pb-2 font-normal">Fechas</th>
                <th scope="col" className="px-2 pb-2 font-normal">Hab.</th>
                <th scope="col" className="px-2 pb-2 font-normal">Estado</th>
                <th scope="col" className="w-6 pb-2"><span className="sr-only">Abrir</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-goldLight/10">
              {reservations.map((reservation) => {
                const nights = nightsBetween(reservation.checkIn, reservation.checkOut);
                const isToday = reservation.checkIn.slice(0, 10) === today;

                return (
                  <tr key={reservation.id} className="transition hover:bg-surface/40 motion-reduce:transition-none">
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/20 text-xs font-semibold text-goldLight">
                          {initials(reservation.guestFullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text">{reservation.guestFullName}</p>
                          <div className="mt-1 scale-90 origin-left">
                            <OriginBadge origin={reservation.origin} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-text">
                      <p className="whitespace-nowrap">
                        {isToday ? <span className="font-semibold text-gold">Hoy</span> : formatShortDate(reservation.checkIn)}
                        {' – '}
                        {formatShortDate(reservation.checkOut)}
                      </p>
                      <p className="text-xs text-textMuted">
                        {nights} {nights === 1 ? 'noche' : 'noches'}
                      </p>
                    </td>
                    <td className="px-2 py-3">
                      <p className="font-medium text-text tabular-nums">{reservation.room.roomNumber}</p>
                      <p className="text-xs text-textMuted">{reservation.room.categoryName}</p>
                    </td>
                    <td className="px-2 py-3">
                      <StatusBadge status={reservation.status} />
                    </td>
                    <td className="py-3 pr-2 text-textMuted">
                      <Link
                        to={`/admin/reservations?dateFrom=${reservation.checkIn.slice(0, 10)}&sortBy=checkIn&sortDir=asc`}
                        aria-label={`Ver la reserva de ${reservation.guestFullName}`}
                        className="flex hover:text-goldLight"
                      >
                        <ChevronRightIcon className="h-5 w-5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardCard>
  );
}
