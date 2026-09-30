import type { ReactNode } from 'react';

interface StatusScreenProps {
  title: string;
  detail?: string;
  badge?: ReactNode;
  children?: ReactNode;
}

/** Card centrada con el mismo lenguaje visual del formulario de prepago. */
export default function PostPayment({ title, detail, badge, children }: StatusScreenProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-shell px-4 py-10">
      <div
        className="pointer-events-none absolute h-72 w-72 rounded-full bg-gold/20 blur-3xl"
        aria-hidden
      />

      <div className="relative w-full max-w-md rounded-3xl border border-goldLight/25 bg-card p-7 text-center shadow-2xl shadow-black/40 sm:p-9">
        {badge && <div className="mb-5 flex justify-center">{badge}</div>}

        <p className="font-poppins text-sm font-semibold text-goldLight/80">OmniDesk</p>
        <h1 className="mt-1 font-poppins text-2xl font-bold text-goldLight">{title}</h1>
        {detail && <p className="mt-3 text-sm leading-relaxed text-textMuted">{detail}</p>}

        {children}
      </div>
    </div>
  );
}
