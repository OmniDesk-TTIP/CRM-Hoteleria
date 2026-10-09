import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/auth.context';
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
} from '@/services/document.service';
import type { KnowledgeDocument } from '@/config/types';
import DocumentUploader from '@/components/admin/DocumentUploader';
import DocumentsTable from '@/components/admin/DocumentsTable';
import ConfirmDeleteDocumentModal from '@/components/admin/ConfirmDeleteDocumentModal';

const POLL_INTERVAL_MS = 2500;

export default function HotelRulesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [deletingDocument, setDeletingDocument] = useState<KnowledgeDocument | null>(null);

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const result = await listDocuments();
      setDocuments(result);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudieron cargar los documentos.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const hasPending = documents.some(
    (d) => d.status === 'PENDING' || d.status === 'PROCESSING',
  );

  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!hasPending) {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = window.setInterval(() => void fetchDocuments(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasPending, fetchDocuments]);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const created = await uploadDocument(file);
      setDocuments((prev) => [created, ...prev]);
    } catch (err: any) {
      setError(err?.response?.data?.message || `No se pudo subir «${file.name}».`);
      throw err;
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingDocument) return;
    await deleteDocument(deletingDocument.id);
    setDeletingDocument(null);
    await fetchDocuments(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-text">Reglas del hotel</h1>
        <p className="text-sm text-textMuted">
          Subí los documentos con las reglas, políticas y servicios del hotel. Chamber los usa
          como fuente de conocimiento en cada respuesta.
        </p>
      </header>

      {isAdmin && (
        <section className="rounded-2xl border border-goldLight/15 bg-card p-4 sm:p-5">
          <DocumentUploader onUpload={handleUpload} disabled={isUploading} />
          {isUploading && (
            <p className="mt-3 text-xs text-textMuted">Subiendo archivo…</p>
          )}
        </section>
      )}

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-dangerText">
          {error}
        </p>
      )}

      <section className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <DocumentsTable
          documents={documents}
          isLoading={isLoading}
          error={null}
          onDelete={(doc) => setDeletingDocument(doc)}
        />
      </section>

      {deletingDocument && (
        <ConfirmDeleteDocumentModal
          document={deletingDocument}
          onClose={() => setDeletingDocument(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}