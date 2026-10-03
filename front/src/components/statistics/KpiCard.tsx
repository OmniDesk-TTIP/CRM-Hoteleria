import type { ComponentType, ReactNode, SVGProps } from 'react';

interface KpiCardProps {
  label: string;
  value: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  hint?: ReactNode;
}

export default function KpiCard({ label, value, icon: Icon, hint }: KpiCardProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-gold/40 bg-card/90 p-5 shadow-lg shadow-black/20 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-textMuted">{label}</h2>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
          <Icon className="h-6 w-6" />
        </span>
      </div>

      <p className="truncate text-3xl font-semibold text-text md:text-4xl">{value}</p>

      {hint && <p className="text-xs leading-relaxed text-textMuted">{hint}</p>}
    </section>
  );
}
