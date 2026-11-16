import type { Promotion, PromotionStatus, PromotionTarget } from '@/config/types';
import { formatIsoDay } from './spaFormat';

export const TARGET_OPTIONS: { value: PromotionTarget; label: string; description: string }[] = [
  { value: 'ROOMS', label: 'Habitaciones', description: 'Se aplica sobre el total de la estadía.' },
  { value: 'SPA', label: 'Spa', description: 'Se aplica a los clientes externos: para los huéspedes el spa no tiene cargo.' },
];

export const targetLabel = (target: PromotionTarget): string =>
  TARGET_OPTIONS.find((option) => option.value === target)?.label ?? target;

export const STATUS_FILTERS: { value: PromotionStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'ACTIVE', label: 'Vigentes' },
  { value: 'SCHEDULED', label: 'Programadas' },
  { value: 'EXPIRED', label: 'Vencidas' },
  { value: 'DISABLED', label: 'Deshabilitadas' },
];

/** Solo tiene sentido difundir lo que Chamber puede ofrecer ahora o más adelante. */
export const canAnnounce = (promotion: Promotion): boolean =>
  promotion.status === 'ACTIVE' || promotion.status === 'SCHEDULED';

export const describeValidity = ({ startDate, endDate }: Pick<Promotion, 'startDate' | 'endDate'>): string =>
  `Del ${formatIsoDay(startDate)} al ${formatIsoDay(endDate)}`;

/** Texto inicial de la campaña que anuncia la promoción; se puede editar antes de enviar. */
export const buildPromotionMessage = (promotion: Promotion): string =>
  [
    promotion.description,
    '',
    `🎉 ${promotion.discountPercentage}% de descuento en ${targetLabel(promotion.target).toLowerCase()}.`,
    `📅 ${describeValidity(promotion)}.`,
    ...(promotion.minNights ? [`🛏️ Mínimo ${promotion.minNights} noches.`] : []),
    '',
    'Escribinos por acá para reservar.',
  ].join('\n');
