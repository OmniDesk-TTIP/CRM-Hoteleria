import logoOmnidesk from '@/assets/logo-omnidesk-480.webp';
import logoOmnideskLight from '@/assets/logo-omnidesk-light.png';
import { useTheme } from '@/context/theme.context';

export default function BrandPanel() {
  const { theme } = useTheme();

  return (
    <aside className="relative hidden overflow-hidden bg-linear-to-br from-surface via-card to-shell lg:flex lg:w-1/2 lg:flex-col lg:items-center lg:justify-center lg:px-16">
      <IsometricBackdrop />

      <div
        className="pointer-events-none absolute -left-24 -top-28 h-96 w-96 rounded-full bg-gold/20 blur-3xl"
        aria-hidden
      />

      <div className="relative w-full max-w-sm">
        <img
          src={theme === 'light' ? logoOmnideskLight : logoOmnidesk}
          alt="OmniDesk"
          width={480}
          height={584}
          className="h-auto w-48 xl:w-56"
        />

        <p className="mt-10 max-w-sm font-poppins text-2xl font-semibold leading-snug text-goldLight">
          La recepción de tu hotel, siempre despierta.
        </p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-textMuted">
          Reservas, señas y consultas del huésped en un solo lugar.
        </p>
      </div>
    </aside>
  );
}

function IsometricBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
    >
      <defs>
        <g id="iso-cube">
          <path d="M0 -60 L52 -30 L0 0 L-52 -30 Z" className="fill-goldLight/10" />
          <path d="M-52 -30 L0 0 L0 60 L-52 30 Z" className="fill-shell/40" />
          <path d="M52 -30 L0 0 L0 60 L52 30 Z" className="fill-gold/10" />
        </g>
      </defs>

      <use href="#iso-cube" transform="translate(30 120) scale(1.7)" opacity="0.5" />
      <use href="#iso-cube" transform="translate(575 200) scale(2.4)" opacity="0.3" />
      <use href="#iso-cube" transform="translate(540 710) scale(1.5)" opacity="0.45" />
      <use href="#iso-cube" transform="translate(70 840) scale(1.1)" opacity="0.35" />
    </svg>
  );
}
