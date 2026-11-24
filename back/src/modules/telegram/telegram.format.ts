import { Markup } from 'telegraf';
import type { AlternativeDates } from '../reservation/reservation.service';

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Arma un link clickeable. La URL se escapa aparte porque va dentro de un atributo. */
export const htmlLink = (url: string, label: string): string =>
  `<a href="${escapeHtml(encodeURI(url))}">${escapeHtml(label)}</a>`;

/** botones del aviso de reserva vencida. */
export const EXPIRED_RESUME_LABEL = 'Retomar reserva';
export const EXPIRED_DECLINE_LABEL = 'No, gracias';
export const EXPIRED_RECOVERY_CALLBACK =
  /^expired:(resume|decline):([0-9a-f-]{36})$/;

export const expiredRecoveryKeyboard = (reservationId: string) =>
  Markup.inlineKeyboard([
    Markup.button.callback(
      EXPIRED_RESUME_LABEL,
      `expired:resume:${reservationId}`,
    ),
    Markup.button.callback(
      EXPIRED_DECLINE_LABEL,
      `expired:decline:${reservationId}`,
    ),
  ]);

/** Botón de los resúmenes anteriores a US-27: sigue funcionando como "Pagar ahora". */
export const ROOM_SERVICE_CONFIRM_LABEL = 'Confirmar pedido';
export const ROOM_SERVICE_PAY_NOW_LABEL = 'Pagar ahora';
export const ROOM_SERVICE_CHARGE_LABEL = 'Cargar a la habitación';
export const ROOM_SERVICE_DISCARD_LABEL = 'No, gracias';
export const ROOM_SERVICE_CANCEL_LABEL = 'Sí, cancelar';
export const ROOM_SERVICE_KEEP_LABEL = 'No, mantenerlo';
export const ROOM_SERVICE_CALLBACK =
  /^roomservice:(confirm|pay|charge|discard|cancel|keep):([0-9a-f-]{36})$/;

export type RoomServiceButton =
  'confirm' | 'pay' | 'charge' | 'discard' | 'cancel' | 'keep';

export const ROOM_SERVICE_BUTTON_LABELS: Record<RoomServiceButton, string> = {
  confirm: ROOM_SERVICE_CONFIRM_LABEL,
  pay: ROOM_SERVICE_PAY_NOW_LABEL,
  charge: ROOM_SERVICE_CHARGE_LABEL,
  discard: ROOM_SERVICE_DISCARD_LABEL,
  cancel: ROOM_SERVICE_CANCEL_LABEL,
  keep: ROOM_SERVICE_KEEP_LABEL,
};

/**
 * US-27: el huésped confirma eligiendo cómo pagar. "Cargar a la habitación" solo aparece si su
 * reserva tiene la cuenta corriente abierta.
 */
export const roomServiceConfirmKeyboard = (
  orderId: string,
  canChargeToRoom: boolean,
) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback(
        ROOM_SERVICE_PAY_NOW_LABEL,
        `roomservice:pay:${orderId}`,
      ),
      ...(canChargeToRoom
        ? [
            Markup.button.callback(
              ROOM_SERVICE_CHARGE_LABEL,
              `roomservice:charge:${orderId}`,
            ),
          ]
        : []),
    ],
    [
      Markup.button.callback(
        ROOM_SERVICE_DISCARD_LABEL,
        `roomservice:discard:${orderId}`,
      ),
    ],
  ]);

export const roomServiceCancelKeyboard = (orderId: string) =>
  Markup.inlineKeyboard([
    Markup.button.callback(
      ROOM_SERVICE_CANCEL_LABEL,
      `roomservice:cancel:${orderId}`,
    ),
    Markup.button.callback(
      ROOM_SERVICE_KEEP_LABEL,
      `roomservice:keep:${orderId}`,
    ),
  ]);

/** Lista de fechas alternativas cuando Gemini no pudo redactar la respuesta. */
export const formatAlternativesFallback = (
  alternatives: AlternativeDates[],
  intro = 'Lamentablemente no tenemos lugar en esas fechas, pero encontré estas opciones cercanas:',
): string => {
  const options = alternatives.map(
    ({
      checkIn,
      checkOut,
      nights,
      isShorterStay,
      roomCategory,
      totalAmount,
      promotion,
    }) =>
      `• Del ${checkIn} al ${checkOut} (${nights} noches${isShorterStay ? ', estadía más corta' : ''}) – ${escapeHtml(roomCategory)}, total $${totalAmount}${promotion ? ` con la promoción ${escapeHtml(promotion)}` : ''}`,
  );
  return [intro, ...options, '', '¿Te sirve alguna?'].join('\n');
};
