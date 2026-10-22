import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countCampaignRecipients, createCampaign, listCampaigns } from '@/services/campaign.service';
import type { Campaign, CampaignAudience } from '@/config/types';
import CampaignPreview from '@/components/campaigns/CampaignPreview';
import ConfirmCampaignModal from '@/components/campaigns/ConfirmCampaignModal';
import CampaignHistory from '@/components/campaigns/CampaignHistory';
import {
  ACCEPTED_IMAGE_TYPES,
  AUDIENCE_OPTIONS,
  MAX_IMAGE_BYTES,
  MAX_TITLE_LENGTH,
  maxMessageLength,
  pluralizeContacts,
} from '@/components/campaigns/campaignFormat';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const PAGE_SIZE = 10;
/** Mientras haya una campaña enviándose, el historial se actualiza solo. */
const POLL_INTERVAL_MS = 3000;

const inputClasses =
  'w-full min-w-0 rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

/** US-13: campañas masivas por Telegram. Solo Administradores (CA6). */
export default function CampaignsPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<CampaignAudience>('ALL');
  const [image, setImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [recipients, setRecipients] = useState<number | null>(null);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);

  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listCampaigns(page, PAGE_SIZE);
      setCampaigns(result.data);
      setTotal(result.total);
      setHistoryError(null);
    } catch (err: unknown) {
      setHistoryError(errorMessage(err, 'Error al cargar las campañas.'));
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const isSending = campaigns.some((campaign) => campaign.status === 'SENDING');
  useEffect(() => {
    if (!isSending) return;
    const timer = setInterval(fetchCampaigns, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isSending, fetchCampaigns]);

  const refreshRecipients = useCallback(async (target: CampaignAudience) => {
    setRecipients(null);
    setRecipientsError(null);
    try {
      setRecipients(await countCampaignRecipients(target));
    } catch (err: unknown) {
      setRecipientsError(errorMessage(err, 'No pude contar los destinatarios.'));
    }
  }, []);

  useEffect(() => {
    refreshRecipients(audience);
  }, [audience, refreshRecipients]);

  // El object URL vive mientras esté elegida la imagen; si no se libera, queda en memoria.
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => {
    if (!imageUrl) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageError(null);
    if (file && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError('La imagen tiene que ser JPG, PNG o WEBP.');
      e.target.value = '';
      return;
    }
    if (file && file.size > MAX_IMAGE_BYTES) {
      setImageError(`La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
      e.target.value = '';
      return;
    }
    setImage(file);
  };

  const removeImage = () => {
    setImage(null);
    setImageError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  const messageLimit = maxMessageLength(trimmedTitle, !!image);
  const isTooLong = trimmedMessage.length > messageLimit;
  const canPreview = !!trimmedTitle && !!trimmedMessage && !isTooLong && recipients !== 0;

  const openConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPreview) return;
    setNotice(null);
    setSubmitError(null);
    setIsConfirming(true);
    // Se vuelve a contar: entre que se eligió el filtro y ahora pudieron escribir contactos nuevos.
    refreshRecipients(audience);
  };

  const handleSend = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const campaign = await createCampaign({ title: trimmedTitle, message: trimmedMessage, audience, image });
      setIsConfirming(false);
      setNotice(
        `Campaña «${campaign.title}» en camino a ${pluralizeContacts(campaign.totalRecipients)}. Podés seguir el envío en el historial.`,
      );
      setTitle('');
      setMessage('');
      removeImage();
      if (page === 1) fetchCampaigns();
      else setPage(1);
    } catch (err: unknown) {
      setSubmitError(errorMessage(err, 'Error al enviar la campaña.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedAudience = AUDIENCE_OPTIONS.find((option) => option.value === audience);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Campañas</h1>
        <p className="text-sm text-textMuted">
          Mensajes masivos por Telegram a los huéspedes que hablaron con Chamber: promociones, novedades y avisos.
        </p>
      </div>

      {notice && (
        <div role="status" className="rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-successText">
          {notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <form
          onSubmit={openConfirmation}
          className="space-y-4 rounded-2xl border border-goldLight/15 bg-card p-4 sm:p-5"
          aria-label="Nueva campaña"
        >
          <h2 className="text-lg font-semibold text-text">Nueva campaña</h2>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Título *
            <input
              required
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej.: Escapada de invierno 20% off"
              className={inputClasses}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Mensaje *
            <textarea
              required
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Contá la promoción o la novedad…"
              className={`${inputClasses} resize-y`}
              aria-describedby="campaign-message-count"
            />
            <span
              id="campaign-message-count"
              className={`self-end text-xs ${isTooLong ? 'text-dangerText' : 'text-textMuted'}`}
            >
              {trimmedMessage.length} / {messageLimit}
              {image ? ' (con imagen el límite es menor)' : ''}
            </span>
          </label>

          <div className="space-y-1 text-sm text-textMuted">
            <span>Imagen (opcional)</span>
            {image ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-goldLight/20 bg-surface px-3 py-2">
                <span className="truncate text-text">{image.name}</span>
                <button
                  type="button"
                  onClick={removeImage}
                  className="shrink-0 text-xs font-medium text-goldLight hover:underline"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                onChange={handleImageChange}
                className="block w-full text-sm text-textMuted file:mr-3 file:rounded-full file:border file:border-goldLight/25 file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-goldLight hover:file:bg-goldLight/10"
              />
            )}
            <p className="text-xs">JPG, PNG o WEBP de hasta {MAX_IMAGE_BYTES / 1024 / 1024} MB. No se guarda en el sistema.</p>
            {imageError && (
              <p role="alert" className="text-xs text-dangerText">
                {imageError}
              </p>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Destinatarios *
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as CampaignAudience)}
              className={inputClasses}
            >
              {AUDIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs">
              {selectedAudience?.description}{' '}
              {recipientsError ? (
                <span className="text-dangerText">{recipientsError}</span>
              ) : recipients === null ? (
                'Contando…'
              ) : (
                <strong className="text-text">{pluralizeContacts(recipients)}.</strong>
              )}
            </span>
          </label>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canPreview}
              className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:opacity-50"
            >
              Vista previa y enviar
            </button>
          </div>
        </form>

        <section aria-label="Vista previa" className="space-y-2">
          <h2 className="text-sm font-medium text-textMuted">Así lo verá el huésped</h2>
          <CampaignPreview title={title} message={message} imageUrl={imageUrl} />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text">Historial</h2>
        <CampaignHistory
          campaigns={campaigns}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          isLoading={isLoading}
          error={historyError}
          onPageChange={setPage}
        />
      </section>

      {isConfirming && (
        <ConfirmCampaignModal
          title={trimmedTitle}
          message={trimmedMessage}
          imageUrl={imageUrl}
          audience={audience}
          recipients={recipients}
          isSubmitting={isSubmitting}
          error={submitError}
          onClose={() => setIsConfirming(false)}
          onConfirm={handleSend}
        />
      )}
    </div>
  );
}
