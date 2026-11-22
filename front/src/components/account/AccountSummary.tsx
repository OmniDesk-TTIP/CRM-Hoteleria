import type { Account } from '@/config/types';
import { ACCOUNT_STATUS_LABELS, formatEntryDateTime, formatPesos, PAYMENT_METHOD_LABELS } from './accountFormat';

const STATUS_CLASSES: Record<Account['status'], string> = {
  OPEN: 'bg-success/20 text-successText',
  CLOSED: 'bg-surface text-textMuted',
};

function balanceCaption(balance: number): string {
  if (balance > 0) return 'Debe el huésped';
  if (balance < 0) return 'Saldo a favor del huésped';
  return 'Sin deuda';
}

interface AccountSummaryProps {
  account: Account;
  /** Si viene, la tarjeta del saldo ofrece "Cobrar saldo" mientras el huésped deba algo. */
  onCollect?: () => void;
}

export default function AccountSummary({ account, onCollect }: AccountSummaryProps) {
  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gold/40 bg-card p-5 sm:col-span-2 lg:col-span-1">
          <p className="text-xs uppercase tracking-wide text-textMuted">Saldo</p>
          <p
            className={`mt-1 text-3xl font-bold ${account.balance > 0 ? 'text-goldLight' : 'text-successText'}`}
            aria-live="polite"
          >
            {formatPesos(Math.abs(account.balance))}
          </p>
          <p className="text-sm text-textMuted">{balanceCaption(account.balance)}</p>
          {onCollect && account.balance > 0 && (
            <button
              type="button"
              onClick={onCollect}
              className="mt-3 w-full rounded-xl bg-gold px-4 py-2 text-sm font-medium text-shell transition hover:bg-goldLight motion-reduce:transition-none"
            >
              Cobrar saldo
            </button>
          )}
        </div>

        <SummaryCard label="Total de cargos" value={formatPesos(account.totalCharges)} />
        <SummaryCard label="Total de pagos" value={formatPesos(account.totalPayments)} />

        <div className="rounded-2xl border border-goldLight/15 bg-card p-5">
          <p className="text-xs uppercase tracking-wide text-textMuted">Estado</p>
          <span
            className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-medium ${STATUS_CLASSES[account.status]}`}
          >
            {ACCOUNT_STATUS_LABELS[account.status]}
          </span>
          {account.closedAt && (
            <p className="mt-2 text-xs text-textMuted">Cerrada el {formatEntryDateTime(account.closedAt)}</p>
          )}
        </div>
      </div>

      <p className="text-xs text-textMuted">
        Abierta el {formatEntryDateTime(account.openedAt)} por {account.openedBy.fullName} al cobrar el resto de la
        estadía ({formatPesos(account.stayBalanceAmount)}, {PAYMENT_METHOD_LABELS[account.stayBalancePaymentMethod]}).
      </p>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-goldLight/15 bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-textMuted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-text">{value}</p>
    </div>
  );
}
