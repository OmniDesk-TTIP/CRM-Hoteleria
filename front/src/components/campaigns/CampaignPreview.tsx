interface CampaignPreviewProps {
  title: string;
  message: string;
  /** Object URL de la imagen elegida; la crea y la libera la página. */
  imageUrl: string | null;
}

/** Cómo le llega el mensaje al huésped en Telegram: título en negrita, mensaje y la imagen arriba. */
export default function CampaignPreview({ title, message, imageUrl }: CampaignPreviewProps) {
  const isEmpty = !title.trim() && !message.trim() && !imageUrl;

  return (
    <div className="rounded-2xl bg-surface p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-textMuted">Chamber · Telegram</p>
      {isEmpty ? (
        <p className="py-6 text-center text-sm text-textMuted">Escribí el título y el mensaje para ver la vista previa.</p>
      ) : (
        <div className="max-w-sm overflow-hidden rounded-2xl rounded-tl-sm border border-goldLight/15 bg-card shadow-sm">
          {imageUrl && <img src={imageUrl} alt="Imagen de la campaña" className="max-h-72 w-full object-cover" />}
          <div className="space-y-2 px-4 py-3 text-sm text-text">
            {title.trim() && <p className="break-words font-bold">{title.trim()}</p>}
            {message.trim() && <p className="whitespace-pre-wrap break-words">{message.trim()}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
