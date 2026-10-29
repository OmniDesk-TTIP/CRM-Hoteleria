import { Markup } from 'telegraf';

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Arma un link clickeable. La URL se escapa aparte porque va dentro de un atributo. */
export const htmlLink = (url: string, label: string): string =>
  `<a href="${escapeHtml(encodeURI(url))}">${escapeHtml(label)}</a>`;

/** US-24: botones del resumen de room service y de la confirmación de cancelación. */
export const ROOM_SERVICE_CONFIRM_LABEL = 'Confirmar pedido';
export const ROOM_SERVICE_DISCARD_LABEL = 'No, gracias';
export const ROOM_SERVICE_CANCEL_LABEL = 'Sí, cancelar';
export const ROOM_SERVICE_KEEP_LABEL = 'No, mantenerlo';
export const ROOM_SERVICE_CALLBACK =
  /^roomservice:(confirm|discard|cancel|keep):([0-9a-f-]{36})$/;

export type RoomServiceButton = 'confirm' | 'discard' | 'cancel' | 'keep';

export const ROOM_SERVICE_BUTTON_LABELS: Record<RoomServiceButton, string> = {
  confirm: ROOM_SERVICE_CONFIRM_LABEL,
  discard: ROOM_SERVICE_DISCARD_LABEL,
  cancel: ROOM_SERVICE_CANCEL_LABEL,
  keep: ROOM_SERVICE_KEEP_LABEL,
};

export const roomServiceConfirmKeyboard = (orderId: string) =>
  Markup.inlineKeyboard([
    Markup.button.callback(
      ROOM_SERVICE_CONFIRM_LABEL,
      `roomservice:confirm:${orderId}`,
    ),
    Markup.button.callback(
      ROOM_SERVICE_DISCARD_LABEL,
      `roomservice:discard:${orderId}`,
    ),
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
