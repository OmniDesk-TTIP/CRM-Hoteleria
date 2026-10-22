import { escapeHtml } from '../telegram/telegram.format';

export const MAX_TITLE_LENGTH = 100;

export const MAX_TEXT_LENGTH = 4096;
export const MAX_CAPTION_LENGTH = 1024;
const TITLE_SEPARATOR = '\n\n';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const BATCH_SIZE = 20;
export const BATCH_INTERVAL_MS = 1000;
export const MAX_ATTEMPTS = 3;

export type ImageType = 'jpeg' | 'png' | 'webp';

export interface CampaignImage {
  buffer: Buffer;
  type: ImageType;
}

export function buildCampaignText(title: string, message: string): string {
  return `<b>${escapeHtml(title)}</b>${TITLE_SEPARATOR}${escapeHtml(message)}`;
}

export function maxMessageLength(title: string, hasImage: boolean): number {
  const limit = hasImage ? MAX_CAPTION_LENGTH : MAX_TEXT_LENGTH;
  return limit - title.length - TITLE_SEPARATOR.length;
}


export function validateCampaignLength(
  title: string,
  message: string,
  hasImage: boolean,
): string | null {
  const max = maxMessageLength(title, hasImage);
  if (message.length <= max) return null;
  return hasImage
    ? `Con imagen, el título y el mensaje no pueden superar ${MAX_CAPTION_LENGTH} caracteres en total`
    : `El título y el mensaje no pueden superar ${MAX_TEXT_LENGTH} caracteres en total`;
}

export function detectImageType(buffer: Buffer): ImageType | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8)
    return buffer[2] === 0xff ? 'jpeg' : undefined;
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return undefined;
}

export function buildChatNotice(
  title: string,
  message: string,
  hasImage: boolean,
): string {
  return `📣 Campaña enviada${hasImage ? ' (con imagen)' : ''}: «${title}»\n${message}`;
}

export type SendErrorKind =
  { kind: 'RETRY'; afterMs: number } | { kind: 'BLOCKED' } | { kind: 'FAILED' };


export function classifySendError(error: unknown): SendErrorKind {
  const telegramError = error as {
    code?: unknown;
    response?: { parameters?: { retry_after?: unknown } };
  } | null;
  const code = telegramError?.code;

  if (code === 429) {
    const retryAfter = Number(telegramError?.response?.parameters?.retry_after);
    const seconds =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1;
    return { kind: 'RETRY', afterMs: seconds * 1000 };
  }
  if (code === 403) return { kind: 'BLOCKED' };
  return { kind: 'FAILED' };
}
