import type { CampaignRecipientFilter } from '@/config/types';
import CampaignPreview from './CampaignPreview';
import { audienceLabel, describeStayFilters, pluralizeContacts } from './campaignFormat';

interface ConfirmCampaignModalProps {
  title: string;
  message: string;
  imageUrl: string | null;
  filter: CampaignRecipientFilter;
  /** null mientras se recalcula. */
  recipients: number | null;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

/** Vista previa, filtros aplicados, cantidad de destinatarios y confirmación antes de mandar (CA4). */
export default function ConfirmCampaignModal({
  title,
  message,
  imageUrl,
  filter,
  recipients,
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: ConfirmCampaignModalProps) {
  const canSend = !isSubmitting && recipients !== null && recipients > 0;
  const stayFilters = describeStayFilters(filter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-campaign-title"
        className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-5 shadow-xl sm:p-6"
      >
        <h2 id="confirm-campaign-title" className="text-lg font-bold text-text">
          ¿Enviar la campaña?
        </h2>

        <CampaignPreview title={title} message={message} imageUrl={imageUrl} />

        <div role="status" className="rounded-xl border border-goldLight/20 bg-surface p-3 text-sm text-textMuted">
          <dl className="mb-2 space-y-1">
            <div className="flex flex-wrap gap-x-2">
              <dt>Contactos:</dt>
              <dd className="text-text">{audienceLabel(filter.audience)}</dd>
            </div>
            {stayFilters.length > 0 && (
              <div className="flex flex-wrap gap-x-2">
                <dt>Filtros:</dt>
                <dd className="text-text">{stayFilters.join(' · ')}</dd>
              </div>
            )}
          </dl>
          {recipients === null ? (
            'Contando destinatarios…'
          ) : recipients === 0 ? (
            <span className="text-dangerText">Ningún contacto cumple estos filtros. Volvé y elegí otros destinatarios.</span>
          ) : (
            <>
              Se enviará a <strong className="text-text">{pluralizeContacts(recipients)}</strong> por Telegram. El envío
              sigue en segundo plano y no se puede cancelar una vez iniciado.
            </>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSend}
            className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:opacity-50"
          >
            {isSubmitting ? 'Enviando...' : 'Sí, enviar campaña'}
          </button>
        </div>
      </div>
    </div>
  );
}
