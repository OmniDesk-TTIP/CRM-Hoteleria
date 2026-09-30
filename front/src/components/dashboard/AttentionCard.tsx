import type { ComponentType, SVGProps } from 'react';
import { Link } from 'react-router-dom';
import DashboardCard from '@/components/dashboard/DashboardCard';
import { HeadsetIcon, ChatIcon, KeyIcon, WalletIcon } from '@/components/layout/icons';
import type { DashboardAttention } from '@/config/types';

interface AttentionCardProps {
  attention: DashboardAttention;
  today: string;
}

interface Counter {
  label: string;
  value: number;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  cta: string;
  to: string;
  urgent?: boolean;
}

export default function AttentionCard({ attention, today }: AttentionCardProps) {
  const counters: Counter[] = [
    {
      label: 'Esperando un operador',
      value: attention.waitingHuman,
      icon: HeadsetIcon,
      cta: 'Atender',
      to: '/admin/chats?pendingHandover=true',
      urgent: attention.waitingHuman > 0,
    },
    {
      label: 'Mis chats activos',
      value: attention.myActiveChats,
      icon: ChatIcon,
      cta: 'Ver chats',
      to: '/admin/chats?assignedToMe=true',
    },
    {
      label: 'Pendientes de pago',
      value: attention.pendingPayment,
      icon: WalletIcon,
      cta: 'Revisar',
      to: '/admin/reservations?status=PENDING_PAYMENT',
    },
    {
      label: 'Check-ins de hoy',
      value: attention.checkInsToday,
      icon: KeyIcon,
      cta: 'Ver llegadas',
      to: `/admin/reservations?status=CONFIRMED&dateFrom=${today}&sortBy=checkIn&sortDir=asc`,
    },
  ];

  return (
    <DashboardCard title="Requiere atención">
      <div className="grid flex-1 grid-cols-2 gap-y-6 lg:grid-cols-4 lg:divide-x lg:divide-gold/30">
        {counters.map(({ label, value, icon: Icon, cta, to, urgent }) => (
          <div key={label} className="flex flex-col items-center gap-3 px-3 text-center">
            <span
              className={`relative flex h-14 w-14 items-center justify-center rounded-2xl ${
                urgent ? 'bg-danger/15 text-dangerText' : 'bg-gold/10 text-gold'
              }`}
            >
              <Icon className="h-8 w-8" />
              {urgent && (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-danger ring-2 ring-card motion-safe:animate-pulse" aria-hidden />
              )}
            </span>

            <div>
              <p className="text-4xl font-semibold text-text">{value}</p>
              <p className="mt-1 text-sm text-textMuted">{label}</p>
            </div>

            <Link
              to={to}
              className="mt-auto rounded-full bg-gold px-5 py-1.5 text-sm font-medium text-shell transition hover:bg-goldLight motion-reduce:transition-none"
            >
              {cta}
            </Link>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}
