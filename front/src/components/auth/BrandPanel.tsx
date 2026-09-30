import logoOmnidesk from '@/assets/logo-omnidesk-480.webp';

/**
 * Panel de marca del login. Se oculta abajo de `lg`: en un celular, ocupar media
 * pantalla con el logo obligaría a scrollear para llegar a los campos.
 */
export default function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-linear-to-br from-surface via-card to-shell lg:flex lg:w-1/2 lg:flex-col lg:justify-center lg:px-16">
      <IsometricBackdrop />

      {/* el mismo resplandor dorado de las pantallas de pago, para que sea la misma app */}
      <div
        className="pointer-events-none absolute -left-24 -top-28 h-96 w-96 rounded-full bg-gold/20 blur-3xl"
        aria-hidden
      />

      <div className="relative">
        {/* width/height son las dimensiones intrínsecas: el navegador reserva el espacio
            antes de que cargue la imagen y no hay salto de layout. */}
        <img
          src={logoOmnidesk}
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

/**
 * Cubos isométricos apenas insinuados, en guiño a los bloques del logo.
 *
 * Va como SVG y no como divs rotados porque un `rotate-45` da un rombo plano de una
 * sola cara: lo que hace leer el bloque como volumen son las tres caras con sombreado
 * distinto. Con `<defs>` + `<use>` la geometría se define una vez y se coloca donde
 * haga falta, y `slice` hace que los cubos grandes sangren por los bordes.
 *
 * Los cubos se ubican solo contra los bordes: la columna del logo y el texto queda
 * limpia. Con la opacidad del `use` encima del alfa del fill, el máximo real es ~0,05.
 */
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
        {/* hexágono isométrico de circunradio 60, partido en tres rombos desde el centro */}
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
