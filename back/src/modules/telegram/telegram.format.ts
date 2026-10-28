import { Markup } from 'telegraf';

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
