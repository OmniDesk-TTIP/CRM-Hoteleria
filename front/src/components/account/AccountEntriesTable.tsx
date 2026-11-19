import type { AccountEntry } from '@/config/types';
import {
  ENTRY_BALANCE_SIGN,
  ENTRY_ORIGIN_LABELS,
  ENTRY_TYPE_LABELS,
  formatEntryDateTime,
  formatSignedAmount,
} from './accountFormat';

const authorName = (entry: AccountEntry) => entry.registeredBy?.fullName ?? 'Chamber';

const amountClasses = (entry: AccountEntry) =>
  `${ENTRY_BALANCE_SIGN[entry.type] > 0 ? 'text-text' : 'text-successText'}${entry.reversed ? ' line-through opacity-60' : ''}`;

function ReversedBadge({ entry }: { entry: AccountEntry }) {
  if (!entry.reversed) return null;
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-dangerText">
      Anulado
    </span>
  );
}

interface AccountEntriesTableProps {
  entries: AccountEntry[];
  /** Si hay movimientos pero ninguno pasa los filtros, el mensaje cambia. */
  hasAnyEntry: boolean;
}

export default function AccountEntriesTable({ entries, hasAnyEntry }: AccountEntriesTableProps) {
  const emptyMessage = hasAnyEntry
    ? 'No hay movimientos para los filtros seleccionados.'
    : 'Todavía no hay movimientos en esta cuenta.';

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium sm:px-5">Fecha</th>
              <th className="px-4 py-3 font-medium sm:px-5">Tipo</th>
              <th className="px-4 py-3 font-medium sm:px-5">Detalle</th>
              <th className="px-4 py-3 font-medium sm:px-5">Origen</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Monto</th>
              <th className="px-4 py-3 font-medium sm:px-5">Registró</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-goldLight/10">
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-textMuted">
                  {emptyMessage}
                </td>
              </tr>
            )}

            {entries.map((entry) => (
              <tr key={entry.id} className="align-top transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">
                  {formatEntryDateTime(entry.registeredAt)}
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <p className="whitespace-nowrap text-text">{ENTRY_TYPE_LABELS[entry.type]}</p>
                  <ReversedBadge entry={entry} />
                </td>
                <td className="max-w-sm px-4 py-3 text-text sm:px-5">{entry.description}</td>
                <td className="whitespace-nowrap px-4 py-3 text-text sm:px-5">{ENTRY_ORIGIN_LABELS[entry.origin]}</td>
                <td className={`whitespace-nowrap px-4 py-3 text-right font-medium sm:px-5 ${amountClasses(entry)}`}>
                  {formatSignedAmount(entry.type, entry.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">{authorName(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lg:hidden">
        {entries.length === 0 && <p className="px-5 py-10 text-center text-sm text-textMuted">{emptyMessage}</p>}

        {entries.length > 0 && (
          <ul className="divide-y divide-goldLight/10">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-1 p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">
                      {ENTRY_TYPE_LABELS[entry.type]} · {ENTRY_ORIGIN_LABELS[entry.origin]}
                    </p>
                    <p className="text-text">{entry.description}</p>
                  </div>
                  <p className={`shrink-0 font-medium ${amountClasses(entry)}`}>
                    {formatSignedAmount(entry.type, entry.amount)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-textMuted">
                  <span>
                    {formatEntryDateTime(entry.registeredAt)} · {authorName(entry)}
                  </span>
                  <ReversedBadge entry={entry} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
