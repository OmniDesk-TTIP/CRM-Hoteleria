import type { KnowledgeDocument, KnowledgeDocumentStatus } from '@/config/types';

interface DocumentsTableProps {
  documents: KnowledgeDocument[];
  isLoading: boolean;
  error: string | null;
  onDelete: (doc: KnowledgeDocument) => void;
}

const STATUS_LABEL: Record<KnowledgeDocumentStatus, string> = {
  PENDING: 'En cola',
  PROCESSING: 'Procesando…',
  READY: 'Indexado',
  ERROR: 'Error',
};

const STATUS_CLASSES: Record<KnowledgeDocumentStatus, string> = {
  PENDING: 'bg-textMuted/15 text-textMuted',
  PROCESSING: 'bg-gold/15 text-goldLight',
  READY: 'bg-success/15 text-successText',
  ERROR: 'bg-danger/15 text-dangerText',
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

function StatusBadge({ status }: { status: KnowledgeDocumentStatus }) {
  const isPending = status === 'PENDING' || status === 'PROCESSING';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {isPending && (
        <span
          className={`h-1.5 w-1.5 rounded-full bg-current ${status === 'PROCESSING' ? 'motion-safe:animate-pulse' : ''}`}
          aria-hidden
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

const deleteButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 motion-reduce:transition-none';

export default function DocumentsTable({
  documents,
  isLoading,
  error,
  onDelete,
}: DocumentsTableProps) {
  const message = isLoading
    ? { text: 'Cargando documentos…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : documents.length === 0
        ? { text: 'Todavía no cargaste documentos.', tone: 'text-textMuted' }
        : null;

  const rows = message ? [] : documents;

  return (
    <>
      {/* Tabla: pantallas anchas */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium sm:px-5">Nombre</th>
              <th className="px-4 py-3 font-medium sm:px-5">Tipo</th>
              <th className="px-4 py-3 font-medium sm:px-5">Tamaño</th>
              <th className="px-4 py-3 font-medium sm:px-5">Fecha</th>
              <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
              <th className="px-4 py-3 font-medium text-right sm:px-5">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-goldLight/10">
            {message && (
              <tr>
                <td colSpan={6} className={`px-5 py-10 text-center ${message.tone}`}>
                  {message.text}
                </td>
              </tr>
            )}

            {rows.map((doc) => (
              <tr
                key={doc.id}
                className="transition hover:bg-surface/50 motion-reduce:transition-none"
              >
                <td className="px-4 py-3 sm:px-5">
                  <p className="max-w-[280px] truncate font-medium text-text" title={doc.filename}>
                    {doc.filename}
                  </p>
                  {doc.status === 'ERROR' && doc.errorMessage && (
                    <p
                      className="mt-0.5 max-w-[280px] truncate text-xs text-dangerText"
                      title={doc.errorMessage}
                    >
                      {doc.errorMessage}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-textMuted sm:px-5">{doc.type}</td>
                <td className="px-4 py-3 whitespace-nowrap text-textMuted sm:px-5">
                  {formatBytes(doc.sizeBytes)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-textMuted sm:px-5">
                  {formatDate(doc.createdAt)}
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <StatusBadge status={doc.status} />
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => onDelete(doc)}
                      className={deleteButtonClasses}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas: celular y tablet */}
      <div className="lg:hidden">
        {message && (
          <p className={`px-5 py-10 text-center text-sm ${message.tone}`}>{message.text}</p>
        )}

        {rows.length > 0 && (
          <ul className="divide-y divide-goldLight/10">
            {rows.map((doc) => (
              <li key={doc.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text" title={doc.filename}>
                      {doc.filename}
                    </p>
                    <p className="text-xs text-textMuted">
                      {doc.type} · {formatBytes(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={doc.status} />
                </div>

                {doc.status === 'ERROR' && doc.errorMessage && (
                  <p className="text-xs text-dangerText">{doc.errorMessage}</p>
                )}

                <button
                  type="button"
                  onClick={() => onDelete(doc)}
                  className={`${deleteButtonClasses} w-full py-2`}
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}