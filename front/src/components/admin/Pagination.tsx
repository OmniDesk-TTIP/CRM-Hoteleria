interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /**
   * Nombre de lo que se pagina ("conversación" / "conversaciones"). Con él el texto dice qué
   * se está contando y, si todo entra en una página, se muestra solo el total sin botones:
   * pensado para columnas angostas como la bandeja de chats.
   */
  itemLabel?: { singular: string; plural: string };
}

const buttonClasses =
  'rounded-full border border-goldLight/20 px-3 py-1.5 font-medium text-text transition hover:bg-goldLight/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Paginación simple (anterior/siguiente + indicador) para la tabla de reservas y la bandeja de chats. */
export default function Pagination({ page, pageSize, total, onPageChange, itemLabel }: PaginationProps) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  if (itemLabel && totalPages === 1) {
    return (
      <div className="border-t border-goldLight/10 px-4 py-3 text-sm text-textMuted sm:px-5">
        <p className="tabular-nums">
          {total} {total === 1 ? itemLabel.singular : itemLabel.plural}
        </p>
      </div>
    );
  }

  const summary = itemLabel
    ? `${capitalize(itemLabel.plural)} ${from}–${to} de ${total}`
    : total === 0
      ? 'Sin resultados'
      : `Mostrando ${from}–${to} de ${total}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-goldLight/10 px-4 py-3 text-sm text-textMuted sm:px-5">
      <p className="tabular-nums">{summary}</p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className={buttonClasses}>
          Anterior
        </button>
        <span className="whitespace-nowrap px-1 text-xs tabular-nums" aria-label={`Página ${page} de ${totalPages}`}>
          Pág. {page} de {totalPages}
        </span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className={buttonClasses}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
