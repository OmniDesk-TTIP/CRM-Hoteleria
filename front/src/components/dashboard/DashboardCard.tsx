import type { ReactNode } from 'react';

interface DashboardCardProps {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}


export default function DashboardCard({ title, action, className = '', children }: DashboardCardProps) {
  return (
    <section className={`flex flex-col rounded-2xl border border-gold/40 bg-card/90 p-5 shadow-lg shadow-black/20 md:p-6 ${className}`}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-goldLight md:text-xl">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
