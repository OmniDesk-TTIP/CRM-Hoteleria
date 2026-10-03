import DashboardCard from '@/components/dashboard/DashboardCard';

const ITEMS = [
  {
    term: 'Reservas',
    text: 'Solo cuentan las confirmadas (con la seña acreditada). "Bot" son las que cerró el asistente de forma autónoma; "Manual", las que se cargaron desde el panel.',
  },
  {
    term: 'Ingresos por IA',
    text: 'La seña que cobró Mercado Pago en las reservas del bot. El valor total de esas reservas incluye además el saldo que se paga en el hotel.',
  },
  {
    term: 'Chats derivados',
    text: 'Conversaciones iniciadas en el período en las que el huésped pidió hablar con una persona o un operador tomó el control. Sirve para ver cuánto resuelve el bot por su cuenta.',
  },
];

export default function MetricsGlossary() {
  return (
    <DashboardCard title="Cómo se calculan">
      <dl className="space-y-4">
        {ITEMS.map(({ term, text }) => (
          <div key={term}>
            <dt className="text-sm font-semibold text-gold">{term}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-textMuted">{text}</dd>
          </div>
        ))}
      </dl>
    </DashboardCard>
  );
}
