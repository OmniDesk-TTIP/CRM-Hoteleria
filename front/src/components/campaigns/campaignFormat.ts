import type { CampaignAudience, CampaignStatus } from '@/config/types';

/** Espejo de los límites del back (campaign.model.ts): Telegram cuenta título + "\n\n" + mensaje. */
export const MAX_TITLE_LENGTH = 100;
const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
const TITLE_SEPARATOR_LENGTH = 2;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Con imagen el texto va como pie de foto, que admite bastante menos. */
export const maxMessageLength = (title: string, hasImage: boolean): number =>
  (hasImage ? MAX_CAPTION_LENGTH : MAX_TEXT_LENGTH) - title.length - TITLE_SEPARATOR_LENGTH;

export const AUDIENCE_OPTIONS: { value: CampaignAudience; label: string; description: string }[] = [
  { value: 'ALL', label: 'Todos los contactos', description: 'Todos los que alguna vez le escribieron a Chamber.' },
  {
    value: 'CONFIRMED',
    label: 'Con reserva confirmada',
    description: 'Tienen al menos una reserva confirmada, de cualquier fecha.',
  },
  {
    value: 'NO_RESERVATION',
    label: 'Sin reserva',
    description: 'Nunca confirmaron una reserva (incluye pagos pendientes y canceladas).',
  },
];

export const audienceLabel = (audience: CampaignAudience): string =>
  AUDIENCE_OPTIONS.find((option) => option.value === audience)?.label ?? audience;

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  SENDING: 'Enviando',
  COMPLETED: 'Enviada',
  INTERRUPTED: 'Interrumpida',
};

export const formatCampaignDate = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const pluralizeContacts = (count: number): string => (count === 1 ? '1 contacto' : `${count} contactos`);
