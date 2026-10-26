/** Mercado Pago manda el mismo aviso con formatos distintos según el tipo de notificación (body o query). */
export interface WebhookBody {
  id?: string | number;
  type?: string;
  topic?: string;
  data?: { id?: string | number };
}

export interface WebhookQuery {
  id?: string;
  topic?: string;
  'data.id'?: string;
}

/** Id del pago y tipo de evento de una notificación, sea cual sea el formato en que llegó. */
export function readWebhook(
  body: WebhookBody | undefined,
  query: WebhookQuery | undefined,
): { dataId: string | undefined; eventType: string | undefined } {
  const dataId = query?.['data.id'] || body?.data?.id || query?.id || body?.id;

  return {
    dataId: dataId ? String(dataId) : undefined,
    eventType: body?.type || query?.topic || body?.topic,
  };
}
