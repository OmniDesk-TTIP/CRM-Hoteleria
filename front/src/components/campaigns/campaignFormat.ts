import type { CampaignAudience, CampaignRecipientFilter, CampaignStatus, CampaignStayFilter } from '@/config/types';

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

export const EMPTY_RECIPIENT_FILTER: CampaignRecipientFilter = {
  audience: 'ALL',
  stayFilter: null,
  stayFrom: null,
  stayTo: null,
  minGuests: null,
  maxGuests: null,
};

/** Espejo de MAX_GUESTS_FILTER en campaign.model.ts. */
export const MAX_GUESTS_FILTER = 20;

interface StayOption {
  value: CampaignStayFilter;
  label: string;
  description: string;
  /** Qué fecha acota el rango (CA2); sin esto, el estado no admite fechas. */
  rangeLabel?: string;
}

export const STAY_OPTIONS: StayOption[] = [
  {
    value: 'IN_HOUSE',
    label: 'Alojados actualmente',
    description: 'Tienen una reserva confirmada con check-in hasta hoy y check-out después de hoy.',
  },
  {
    value: 'UPCOMING',
    label: 'Con check-in próximo',
    description: 'Tienen una reserva confirmada que todavía no empezó.',
    rangeLabel: 'Check-in',
  },
  {
    value: 'FINISHED',
    label: 'Con estadía finalizada',
    description: 'Ya se hospedaron: reserva confirmada con check-out hasta hoy.',
    rangeLabel: 'Check-out',
  },
  {
    value: 'UNPAID',
    label: 'Pidieron reserva y no pagaron la seña',
    description: 'Reservaron por Chamber y la reserva sigue pendiente de pago o venció sin pagar.',
  },
  {
    value: 'QUOTED',
    label: 'Consultaron disponibilidad y no reservaron',
    description: 'Le pidieron a Chamber una habitación (fechas y personas) pero nunca hicieron una reserva.',
    rangeLabel: 'Check-in consultado',
  },
];

export const stayOption = (stayFilter: CampaignStayFilter | null): StayOption | undefined =>
  STAY_OPTIONS.find((option) => option.value === stayFilter);

/** Mismas reglas que validateRecipientFilter en el back, para avisar antes de pedir el conteo. */
export const recipientFilterError = (filter: CampaignRecipientFilter): string | null => {
  if ((filter.stayFrom || filter.stayTo) && !stayOption(filter.stayFilter)?.rangeLabel)
    return 'El rango de fechas solo se puede usar con check-in próximo, estadía finalizada o consultas sin reserva.';
  if (filter.stayFrom && filter.stayTo && filter.stayFrom > filter.stayTo)
    return 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
  for (const value of [filter.minGuests, filter.maxGuests])
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > MAX_GUESTS_FILTER))
      return `La cantidad de personas tiene que ser un número entero entre 1 y ${MAX_GUESTS_FILTER}.`;
  if (filter.minGuests !== null && filter.maxGuests !== null && filter.minGuests > filter.maxGuests)
    return 'La cantidad mínima de personas no puede superar a la máxima.';
  return null;
};

/** YYYY-MM-DD → "10 nov 2026", sin pasar por la zona horaria del navegador. */
const formatDay = (key: string): string => {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
};

const describeRange = (from: string | null, to: string | null): string | null => {
  if (from && to) return from === to ? `el ${formatDay(from)}` : `entre el ${formatDay(from)} y el ${formatDay(to)}`;
  if (from) return `desde el ${formatDay(from)}`;
  if (to) return `hasta el ${formatDay(to)}`;
  return null;
};

const describeGuests = (min: number | null, max: number | null): string | null => {
  const people = (count: number) => (count === 1 ? '1 persona' : `${count} personas`);
  if (min !== null && max !== null) return min === max ? people(min) : `${min} a ${people(max)}`;
  if (min !== null) return `${people(min)} o más`;
  if (max !== null) return `hasta ${people(max)}`;
  return null;
};

/**
 * Filtros por estadía en palabras, para la confirmación y el historial (CA5). Vacío si no hay.
 * Ej.: ["Con estadía finalizada", "Check-out entre el 1 oct 2026 y el 31 oct 2026", "Reserva para 2 a 4 personas"].
 */
export const describeStayFilters = (filter: CampaignRecipientFilter): string[] => {
  const option = stayOption(filter.stayFilter);
  const range = describeRange(filter.stayFrom, filter.stayTo);
  const guests = describeGuests(filter.minGuests, filter.maxGuests);
  return [
    option?.label,
    option?.rangeLabel && range ? `${option.rangeLabel} ${range}` : null,
    guests ? `${filter.stayFilter === 'QUOTED' ? 'Consulta' : 'Reserva'} para ${guests}` : null,
  ].filter((part): part is string => !!part);
};

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
