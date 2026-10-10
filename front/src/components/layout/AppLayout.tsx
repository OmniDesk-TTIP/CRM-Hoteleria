import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import logoOmnidesk from '@/assets/logo-omnidesk-480.webp';
import { useAuth } from '@/context/auth.context';
import { useSocket } from '@/context/socket.context';
import { useChatActivityRefresh } from '@/hooks/useChatActivityRefresh';
import { getDashboardStatus } from '@/services/dashboard.service';
import { listSpaReservations } from '@/services/spaReservation.service';
import ThemeToggle from '@/components/layout/ThemeToggle';
import type { LayoutContext } from '@/components/layout/layout.context';
import type { DashboardStatus, UserRole } from '@/config/types';
import {
  BedIcon,
  CalendarIcon,
  ChatIcon,
  ChartIcon,
  ClockIcon,
  HomeIcon,
  LogoutIcon,
} from '@/components/layout/icons';

interface NavItem {
  to: string;
  label: string;
  /** Rótulo corto para la barra inferior del celular, donde `label` no entra. */
  shortLabel?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Sin `roles` lo ve cualquier usuario logueado. */
  roles?: UserRole[];
  /** `end` para que Home no quede activo en todas las rutas /admin/*. */
  end?: boolean;
  /** Contador sobre el ícono: chats esperando operador o turnos de spa pendientes. */
  badge?: 'chat' | 'spaReservations';
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Home', icon: HomeIcon, end: true },
  { to: '/admin/chats', label: 'Chats', icon: ChatIcon, badge: 'chat' },
  { to: '/admin/reservations', label: 'Reservas', icon: CalendarIcon, badge: 'spaReservations' },
  {
    to: '/admin/services',
    label: 'Habitaciones y servicios',
    shortLabel: 'Servicios',
    icon: BedIcon,
  },
  { to: '/admin/statistics', label: 'Métricas', icon: ChartIcon, roles: ['ADMIN'] },
  { to: '/admin/support-hours', label: 'Horarios', icon: ClockIcon, roles: ['ADMIN'] },
];

function NavBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="absolute -right-2.5 -top-2 min-w-[1.1rem] rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white ring-2 ring-shell"
      aria-label={`${count} ${label}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Reloj de la barra inferior. Se actualiza cada 30s: los minutos alcanzan. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { isConnected } = useSocket();
  const now = useClock();
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [pendingSpaReservations, setPendingSpaReservations] = useState(0);

  const fetchStatus = useCallback(() => {
    getDashboardStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchStatus();
    // El horario de soporte cambia con el reloj, no con eventos: se relee cada 5 minutos.
    const id = setInterval(fetchStatus, 5 * 60_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useChatActivityRefresh(fetchStatus);

  const fetchPendingSpaReservations = useCallback(() => {
    listSpaReservations({ status: 'PENDING', page: 1, pageSize: 1 })
      .then((result) => setPendingSpaReservations(result.total))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchPendingSpaReservations();
    // Los turnos los crea el bot sin avisar por socket: se relee seguido, la consulta es mínima.
    const id = setInterval(fetchPendingSpaReservations, 60_000);
    return () => clearInterval(id);
  }, [fetchPendingSpaReservations]);

  const items = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  const waitingHuman = status?.waitingHuman ?? 0;
  const layoutContext: LayoutContext = {
    pendingSpaReservations,
    refreshPendingSpaReservations: fetchPendingSpaReservations,
  };
  const badgeFor = (badge: NavItem['badge']) =>
    badge === 'chat' ? waitingHuman : badge === 'spaReservations' ? pendingSpaReservations : 0;
  const badgeLabel = (badge: NavItem['badge']) =>
    badge === 'chat' ? 'chats esperando un operador' : 'turnos de spa pendientes';

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-shell md:flex-row">
      <aside className="hidden w-24 shrink-0 flex-col items-center border-r border-goldLight/10 bg-shell py-5 md:flex">
        <img src={logoOmnidesk} alt="OmniDesk" width={480} height={584} className="h-12 w-auto" />

        <nav className="mt-8 flex w-full flex-1 flex-col gap-1" aria-label="Secciones del panel">
          {items.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) =>
                `group relative flex flex-col items-center gap-1 py-3 text-[10px] font-medium uppercase tracking-wide transition motion-reduce:transition-none ${
                  isActive ? 'bg-surface text-gold' : 'text-textMuted hover:bg-surface/50 hover:text-goldLight'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-0 left-0 w-1 rounded-r bg-gold" aria-hidden />}
                  <span className="relative">
                    <Icon className="h-6 w-6" />
                    {badge && badgeFor(badge) > 0 && (
                      <NavBadge count={badgeFor(badge)} label={badgeLabel(badge)} />
                    )}
                  </span>
                  <span className="hidden text-center leading-tight md:block">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <ThemeToggle
          showLabel
          className="flex flex-col items-center gap-1 py-3 text-[10px] font-medium uppercase tracking-wide text-textMuted transition hover:text-goldLight motion-reduce:transition-none"
        />

        <button
          type="button"
          onClick={() => void logout()}
          title="Cerrar sesión"
          className="flex flex-col items-center gap-1 py-3 text-[10px] font-medium uppercase tracking-wide text-textMuted transition hover:text-goldLight motion-reduce:transition-none"
        >
          <LogoutIcon className="h-6 w-6" />
          <span className="hidden md:block">Salir</span>
        </button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-linear-to-br from-surface/50 via-shell to-shell">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-goldLight/10 bg-shell/80 px-4 md:hidden">
          <img src={logoOmnidesk} alt="OmniDesk" width={480} height={584} className="h-8 w-auto shrink-0" />

          <div className="min-w-0 flex-1">
            {status && (
              <span className="flex min-w-0 items-center gap-2 text-xs text-textMuted">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${status.support.isOpen ? 'bg-success' : 'bg-danger'}`}
                  aria-hidden
                />
                <span className="truncate">
                  {status.support.isOpen
                    ? 'Recepción abierta'
                    : `Recepción cerrada${status.support.nextOpeningLabel ? ` · abre ${status.support.nextOpeningLabel}` : ''}`}
                </span>
              </span>
            )}
          </div>

          <ThemeToggle className="shrink-0 rounded-full p-2 text-textMuted transition hover:bg-surface hover:text-goldLight motion-reduce:transition-none" />
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="shrink-0 rounded-full p-2 text-textMuted transition hover:bg-surface hover:text-goldLight motion-reduce:transition-none"
          >
            <LogoutIcon className="h-6 w-6" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet context={layoutContext} />
        </main>

        <footer className="hidden h-10 shrink-0 items-center gap-4 border-t border-goldLight/10 bg-shell/80 px-4 text-xs text-textMuted md:flex md:px-6">
          {status && (
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${status.support.isOpen ? 'bg-success' : 'bg-danger'}`}
                aria-hidden
              />
              <span className="truncate">
                {status.support.isOpen
                  ? 'Recepción abierta'
                  : `Recepción cerrada${status.support.nextOpeningLabel ? ` · abre ${status.support.nextOpeningLabel}` : ''}`}
              </span>
            </span>
          )}

          <span className="hidden items-center gap-2 sm:flex">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-success' : 'bg-danger'}`} aria-hidden />
            {isConnected ? 'En vivo' : 'Sin conexión en vivo'}
          </span>

          <span className="ml-auto flex items-center gap-2 tabular-nums">
            <ClockIcon className="h-4 w-4" />
            {now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>

          {user && <span className="hidden truncate text-goldLight md:block">{user.fullName}</span>}
        </footer>

        <nav className="flex shrink-0 border-t border-goldLight/10 bg-shell md:hidden" aria-label="Secciones del panel">
          {items.map(({ to, label, shortLabel, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium transition motion-reduce:transition-none ${
                  isActive ? 'bg-surface text-gold' : 'text-textMuted hover:text-goldLight'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-gold" aria-hidden />}
                  <span className="relative">
                    <Icon className="h-6 w-6" />
                    {badge && badgeFor(badge) > 0 && (
                      <NavBadge count={badgeFor(badge)} label={badgeLabel(badge)} />
                    )}
                  </span>
                  <span className="max-w-full truncate">{shortLabel ?? label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
