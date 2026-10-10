import { useState } from 'react';
import type { KnowledgeDocument } from '@/config/types';

interface ConfirmDeleteDocumentModalProps {
  document: KnowledgeDocument;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmDeleteDocumentModal({
  document,
  onClose,
  onConfirm,
}: ConfirmDeleteDocumentModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          'No se pudo eliminar el documento. Intentá de nuevo.',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-goldLight/20 bg-card p-5 shadow-xl sm:p-6">
        <h2 className="text-lg font-bold text-text">Eliminar documento</h2>
        <p className="mt-2 text-sm text-textMuted">
          Vas a eliminar <span className="font-medium text-text">«{document.filename}»</span>.
          Se borran el archivo y todos sus embeddings: Chamber deja de usar esta
          información en la próxima consulta.
        </p>
        <p className="mt-2 text-sm font-medium text-dangerText">Esta acción no se puede deshacer.</p>

        {error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-dangerText">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-goldLight/10 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="rounded-xl bg-danger px-4 py-2 font-medium text-white transition hover:bg-danger/80 disabled:opacity-50"
          >
            {isSubmitting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}