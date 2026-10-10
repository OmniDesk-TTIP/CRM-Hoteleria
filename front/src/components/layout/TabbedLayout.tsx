import { NavLink, Outlet } from 'react-router-dom';
import { useLayoutContext } from '@/components/layout/layout.context';

export interface TabItem {
  to: string;
  label: string;
  /** `end` para que la pestaña principal no quede activa también en las hijas. */
  end?: boolean;
  /** Muestra un contador al lado del nombre cuando es mayor a 0. */
  badge?: 'pendingSpaReservations';
}

interface TabbedLayoutProps {
  tabs: TabItem[];
  /** Mismo ancho máximo que las páginas de la sección, para que la barra quede alineada con ellas. */
  maxWidth: 'max-w-6xl' | 'max-w-7xl';
}

/** Barra de pestañas (una ruta por pestaña) y, debajo, la pantalla que corresponde. */
export default function TabbedLayout({ tabs, maxWidth }: TabbedLayoutProps) {
  const context = useLayoutContext();

  return (
    <>
      <div className={`mx-auto px-4 pt-4 md:px-6 md:pt-6 ${maxWidth}`}>
        <nav
          aria-label="Secciones"
          className="inline-flex gap-1 rounded-full border border-goldLight/15 bg-card p-1"
        >
          {tabs.map(({ to, label, end, badge }) => {
            const count = badge ? context[badge] : 0;

            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition motion-reduce:transition-none ${
                    isActive ? 'bg-gold text-shell' : 'text-textMuted hover:text-text'
                  }`
                }
              >
                {label}
                {count > 0 && (
                  <span
                    className="min-w-[1.25rem] rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-white"
                    aria-label={`${count} pendientes`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <Outlet context={context} />
    </>
  );
}
