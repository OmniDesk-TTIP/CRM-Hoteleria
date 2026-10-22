import { Telegram } from 'telegraf';
import {
  BATCH_INTERVAL_MS,
  BATCH_SIZE,
  CampaignImage,
  classifySendError,
  MAX_ATTEMPTS,
} from './campaign.model';

export type DeliveryOutcome = 'SENT' | 'BLOCKED' | 'FAILED';

export interface DeliveryResult {
  telegramUserId: string;
  outcome: DeliveryOutcome;
}

export interface CampaignContent {
  /** Ya armado y escapado: va con parse_mode HTML. */
  text: string;
  image?: CampaignImage;
}

export interface DispatcherOptions {
  batchSize?: number;
  batchIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type TelegramClient = Pick<Telegram, 'sendMessage' | 'sendPhoto'>;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Manda una campaña respetando los límites de Telegram: lotes de `batchSize` en paralelo y,
 * entre lote y lote, lo que falte para completar `batchIntervalMs`. Un 429 espera lo que pide
 * Telegram y reintenta; un 403 (bloqueó al bot) o cualquier otro error cuenta como fallido y
 * el envío sigue con el resto.
 *
 * La imagen se sube una sola vez: con el primer envío que sale bien Telegram devuelve un
 * file_id y los demás lo reutilizan, así no se sube el archivo N veces.
 */
export class CampaignDispatcher {
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private photoFileId: string | null = null;

  constructor(
    private readonly telegram: TelegramClient,
    options: DispatcherOptions = {},
  ) {
    this.batchSize = options.batchSize ?? BATCH_SIZE;
    this.batchIntervalMs = options.batchIntervalMs ?? BATCH_INTERVAL_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async run(
    recipients: string[],
    content: CampaignContent,
    onBatch: (results: DeliveryResult[]) => Promise<void>,
  ): Promise<void> {
    let pending = recipients;

    // Hasta tener el file_id, los envíos con imagen van de a uno: subir el mismo archivo en
    // paralelo a 20 personas es justo lo que se quiere evitar.
    while (content.image && !this.photoFileId && pending.length > 0) {
      const startedAt = this.now();
      const [first, ...rest] = pending;
      await onBatch([await this.deliver(first, content)]);
      pending = rest;
      if (pending.length > 0) await this.waitSince(startedAt);
    }

    for (let index = 0; index < pending.length; index += this.batchSize) {
      const startedAt = this.now();
      const batch = pending.slice(index, index + this.batchSize);
      const results = await Promise.all(
        batch.map((telegramUserId) => this.deliver(telegramUserId, content)),
      );
      await onBatch(results);

      if (index + this.batchSize < pending.length)
        await this.waitSince(startedAt);
    }
  }

  private async deliver(
    telegramUserId: string,
    content: CampaignContent,
  ): Promise<DeliveryResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.send(telegramUserId, content);
        return { telegramUserId, outcome: 'SENT' };
      } catch (error) {
        const classified = classifySendError(error);
        if (classified.kind === 'BLOCKED')
          return { telegramUserId, outcome: 'BLOCKED' };
        if (classified.kind === 'FAILED' || attempt >= MAX_ATTEMPTS)
          return { telegramUserId, outcome: 'FAILED' };
        await this.sleep(classified.afterMs);
      }
    }
  }

  private async send(
    telegramUserId: string,
    content: CampaignContent,
  ): Promise<void> {
    if (!content.image) {
      await this.telegram.sendMessage(telegramUserId, content.text, {
        parse_mode: 'HTML',
      });
      return;
    }

    const photo = this.photoFileId ?? {
      source: content.image.buffer,
      filename: `campania.${content.image.type === 'jpeg' ? 'jpg' : content.image.type}`,
    };
    const sent = await this.telegram.sendPhoto(telegramUserId, photo, {
      caption: content.text,
      parse_mode: 'HTML',
    });
    // Telegram devuelve la foto en varios tamaños; el último es el original.
    this.photoFileId ??= sent.photo.at(-1)?.file_id ?? null;
  }

  private async waitSince(startedAt: number): Promise<void> {
    const remaining = this.batchIntervalMs - (this.now() - startedAt);
    if (remaining > 0) await this.sleep(remaining);
  }
}
