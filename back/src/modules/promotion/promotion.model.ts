import { v4 } from 'uuid';
import { round2 } from '../../common/number.util';
import { PromotionTarget } from '../../infrastructure/database/entities/Promotion.entity';
import { escapeHtml } from '../telegram/telegram.format';

export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
/** Con 100% la seña daría $0 y Mercado Pago no genera un link de pago por ese monto. */
export const MAX_DISCOUNT_PERCENTAGE = 99;

/** Tope de promociones y de largo de descripción para no inflar el prompt de cada mensaje. */
export const MAX_PROMOTIONS_IN_BLOCK = 10;
const MAX_DESCRIPTION_IN_BLOCK = 300;

export enum PromotionStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  DISABLED = 'DISABLED',
}

export interface PromotionProps {
  id: string;
  title: string;
  description: string;
  discountPercentage: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  target: PromotionTarget;
  minNights: number | null;
  enabled: boolean;
  createdAt?: Date;
}

export type PromotionData = Omit<
  PromotionProps,
  'id' | 'enabled' | 'createdAt'
>;

export interface PromotionPurchase {
  target: PromotionTarget;
  /** Solo para habitaciones. */
  nights?: number;
}

const TARGET_LABELS: Record<PromotionTarget, string> = {
  [PromotionTarget.ROOMS]: 'habitaciones',
  [PromotionTarget.SPA]: 'servicios de spa (clientes externos)',
};

const toChatDate = (isoDay: string): string =>
  isoDay.split('-').reverse().join('-');

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Regla de negocio de una promoción. Pura: el repository la convierte desde y hacia la entidad. */
export class PromotionModel {
  readonly id: string;
  title: string;
  description: string;
  discountPercentage: number;
  startDate: string;
  endDate: string;
  target: PromotionTarget;
  minNights: number | null;
  enabled: boolean;
  readonly createdAt?: Date;

  constructor(props: PromotionProps) {
    this.id = props.id;
    this.title = props.title;
    this.description = props.description;
    this.discountPercentage = props.discountPercentage;
    this.startDate = props.startDate;
    this.endDate = props.endDate;
    this.target = props.target;
    this.minNights = props.minNights;
    this.enabled = props.enabled;
    this.createdAt = props.createdAt;
  }

  static create(data: PromotionData): PromotionModel {
    return new PromotionModel({ ...data, id: v4(), enabled: true });
  }

  applyChanges(data: PromotionData): void {
    this.title = data.title;
    this.description = data.description;
    this.discountPercentage = data.discountPercentage;
    this.startDate = data.startDate;
    this.endDate = data.endDate;
    this.target = data.target;
    this.minNights = data.minNights;
  }

  getError(): string | null {
    if (this.endDate < this.startDate) {
      return 'La fecha de fin no puede ser anterior a la de inicio';
    }
    if (this.minNights !== null && this.target !== PromotionTarget.ROOMS) {
      return 'La cantidad mínima de noches solo aplica a habitaciones';
    }
    return null;
  }

  /** `today` va en YYYY-MM-DD: comparar strings equivale a comparar días. Inicio y fin están incluidos. */
  getStatus(today: string): PromotionStatus {
    if (!this.enabled) return PromotionStatus.DISABLED;
    if (today < this.startDate) return PromotionStatus.SCHEDULED;
    if (today > this.endDate) return PromotionStatus.EXPIRED;
    return PromotionStatus.ACTIVE;
  }

  appliesTo({ target, nights = 0 }: PromotionPurchase): boolean {
    return this.target === target && nights >= (this.minNights ?? 0);
  }

  discountOn(amount: number): number {
    return round2((amount * this.discountPercentage) / 100);
  }

  describeConditions(): string {
    return [
      ...(this.minNights ? [`mínimo ${this.minNights} noches`] : []),
      `válida hasta el ${toChatDate(this.endDate)}`,
    ].join(', ');
  }
}

/** Las promociones no se acumulan: gana la de mayor beneficio para el huésped (CA5). */
export function pickBestPromotion(
  promotions: PromotionModel[],
  purchase: PromotionPurchase,
): PromotionModel | null {
  let best: PromotionModel | null = null;
  for (const promotion of promotions) {
    if (!promotion.appliesTo(purchase)) continue;
    if (!best || promotion.discountPercentage > best.discountPercentage) {
      best = promotion;
    }
  }
  return best;
}

export interface PromotionPrice {
  listAmount: number;
  finalAmount: number;
  discountAmount: number;
  promotion: PromotionModel | null;
}

export function priceWithPromotions(
  listAmount: number,
  promotions: PromotionModel[],
  purchase: PromotionPurchase,
): PromotionPrice {
  const promotion = pickBestPromotion(promotions, purchase);
  const discountAmount = promotion ? promotion.discountOn(listAmount) : 0;
  return {
    listAmount,
    finalAmount: round2(listAmount - discountAmount),
    discountAmount,
    promotion,
  };
}

/**
 * Lo que queda registrado en la reserva. Es una foto: si después se edita o se elimina la
 * promoción, la reserva conserva lo que se le aplicó (`id` queda null al eliminarla).
 */
export interface AppliedPromotion {
  id: string | null;
  title: string;
  percentage: number;
  discountAmount: number;
}

export function toAppliedPromotion({
  promotion,
  discountAmount,
}: PromotionPrice): AppliedPromotion | null {
  if (!promotion) return null;
  return {
    id: promotion.id,
    title: promotion.title,
    percentage: promotion.discountPercentage,
    discountAmount,
  };
}

export function buildPromotionLine(promotion: PromotionModel): string {
  return `🎉 Promoción <b>${escapeHtml(promotion.title)}</b>: ${promotion.discountPercentage}% de descuento (${promotion.describeConditions()}).`;
}

/** Monto para el huésped: si hubo descuento, deja a la vista el precio de lista y el ahorro. */
export function describeAmount(price: PromotionPrice): string {
  return price.promotion
    ? `<b>$${price.finalAmount}</b> (antes $${price.listAmount}, ahorrás $${price.discountAmount})`
    : `$${price.finalAmount}`;
}

/**
 * Sección `[PROMOCIONES VIGENTES]` del contexto de Chamber. Se arma en cada mensaje desde la DB,
 * así una promoción deshabilitada, eliminada o vencida deja de ofrecerse en la próxima consulta.
 */
export function buildPromotionsBlock(promotions: PromotionModel[]): string {
  const lines = ['[PROMOCIONES VIGENTES]'];

  if (promotions.length === 0) {
    lines.push('No hay promociones vigentes en este momento.');
  }

  for (const promotion of promotions.slice(0, MAX_PROMOTIONS_IN_BLOCK)) {
    const conditions = promotion.minNights
      ? ` | mínimo ${promotion.minNights} noches`
      : '';
    lines.push(
      `- ${promotion.title} | ${promotion.discountPercentage}% de descuento | aplica a ${TARGET_LABELS[promotion.target]} | del ${toChatDate(promotion.startDate)} al ${toChatDate(promotion.endDate)}${conditions}`,
      `  ${truncate(promotion.description, MAX_DESCRIPTION_IN_BLOCK)}`,
    );
  }

  return lines.join('\n');
}
