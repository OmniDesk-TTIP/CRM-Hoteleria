import { useTheme } from '@/context/theme.context';
import { MoonIcon, SunIcon } from '@/components/layout/icons';

interface ThemeToggleProps {
  className?: string;
  /** Muestra el texto debajo del ícono (solo desde `md`), como los demás botones de la sidebar. */
  showLabel?: boolean;
}

/** Botón que alterna entre modo oscuro y claro. El ícono muestra el modo al que se va a pasar. */
export default function ThemeToggle({ className = '', showLabel = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Modo claro' : 'Modo oscuro';

  return (
    <button type="button" onClick={toggleTheme} title={label} aria-label={`Cambiar a ${label.toLowerCase()}`} className={className}>
      {isDark ? <SunIcon className="h-6 w-6" /> : <MoonIcon className="h-6 w-6" />}
      {showLabel && <span className="hidden md:block">{isDark ? 'Claro' : 'Oscuro'}</span>}
    </button>
  );
}
