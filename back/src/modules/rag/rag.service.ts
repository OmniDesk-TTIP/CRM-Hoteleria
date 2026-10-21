import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FunctionDeclaration,
  GoogleGenerativeAI,
  SchemaType,
} from '@google/generative-ai';
import { RagRepository } from './rag.repository';
import { formatDate } from '../bookingProcess/date.util';
import {
  BookingProcess,
  BookingProcessStep,
} from '../../infrastructure/database/entities/BookingProcess.entity';
import { ChatMessage } from '../../infrastructure/database/entities/ChatMessage.entity';
import { SearchAvailabilityDto } from '../bookingProcess/dto/searchAvailability.dto';
import type { AlternativeDates } from '../reservation/reservation.service';

const CHAT_MODEL = 'gemini-flash-lite-latest';

const HISTORY_SPEAKERS: Record<string, string> = {
  USER: 'Usuario',
  BOT: 'Chamber',
  OPERATOR: 'Recepción',
  SYSTEM: 'Sistema',
};

export enum ChatAction {
  SEARCH_AVAILABILITY = 'SEARCH_AVAILABILITY',
  CONFIRM_RESERVATION = 'CONFIRM_RESERVATION',
  REQUEST_HUMAN = 'REQUEST_HUMAN',
  REQUEST_SPA_BOOKING = 'REQUEST_SPA_BOOKING',
  REQUEST_TABLE_BOOKING = 'REQUEST_TABLE_BOOKING',
  CANCEL_RESERVATION = 'CANCEL_RESERVATION',
  REGISTER_REFUND_ACCOUNT = 'REGISTER_REFUND_ACCOUNT',
  SEND_PAYMENT_LINK = 'SEND_PAYMENT_LINK',
  REPLY = 'REPLY',
}

const REQUEST_SPA_BOOKING_DECLARATION: FunctionDeclaration = {
  name: 'request_spa_booking',
  description:
    'Llama a esta función cuando el cliente quiera un turno de spa y ya te haya indicado qué servicio, ' +
    'qué día y a qué hora. Si falta alguno de esos datos, preguntáselo antes. Usá el id del servicio tal ' +
    'cual figura en [SERVICIOS DEL HOTEL]. Si la sección indica que el cliente es EXTERNO, pedile antes su ' +
    'nombre completo y su DNI y enviálos también; si es HUÉSPED no hace falta.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      serviceId: {
        type: SchemaType.STRING,
        description: 'El id (uuid) del servicio de spa elegido.',
      },
      date: {
        type: SchemaType.STRING,
        description: 'Fecha del turno DD-MM-YYYY.',
      },
      time: {
        type: SchemaType.STRING,
        description: 'Hora de inicio del turno HH:mm (24 horas).',
      },
      fullName: {
        type: SchemaType.STRING,
        description:
          'Nombre completo de quien reserva. Solo para clientes EXTERNOS.',
      },
      dni: {
        type: SchemaType.STRING,
        description:
          'DNI de quien reserva, solo dígitos. Solo para clientes EXTERNOS.',
      },
    },
    required: ['serviceId', 'date', 'time'],
  },
};

const REQUEST_TABLE_BOOKING_DECLARATION: FunctionDeclaration = {
  name: 'request_table_booking',
  description:
    'Llama a esta función cuando el huésped quiera una mesa en el restaurante del hotel y ya te haya indicado ' +
    'qué día, a qué hora y para cuántas personas. Si falta alguno de esos datos, preguntáselo antes. Si mencionó ' +
    'algún pedido especial (alergias, celíacos, cumpleaños, silla para bebé), incluilo en notes.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      date: {
        type: SchemaType.STRING,
        description: 'Fecha de la reserva DD-MM-YYYY.',
      },
      time: {
        type: SchemaType.STRING,
        description: 'Hora de la reserva HH:mm (24 horas).',
      },
      partySize: {
        type: SchemaType.INTEGER,
        description: 'Cantidad de personas.',
      },
      notes: {
        type: SchemaType.STRING,
        description: 'Pedido especial del huésped, si lo mencionó.',
      },
    },
    required: ['date', 'time', 'partySize'],
  },
};

const CANCEL_RESERVATION_DECLARATION: FunctionDeclaration = {
  name: 'cancel_reservation',
  description:
    'Llama a esta función ÚNICAMENTE cuando el cliente pidió cancelar una reserva suya, ya le informaste cuánto se le ' +
    'devuelve según [POLÍTICA DE CANCELACIÓN] y te confirmó de forma explícita que quiere cancelarla. Usá el id tal ' +
    'cual figura en la lista de reservas del cliente. La cancelación no se puede deshacer.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      reservationId: {
        type: SchemaType.STRING,
        description:
          'El id (uuid) de la reserva que el cliente quiere cancelar.',
      },
    },
    required: ['reservationId'],
  },
};

const REGISTER_REFUND_ACCOUNT_DECLARATION: FunctionDeclaration = {
  name: 'register_refund_account',
  description:
    'Llama a esta función cuando el cliente te haya dado el alias de su cuenta bancaria o billetera virtual Y el ' +
    'nombre completo del titular para recibir una devolución que figura en DEVOLUCIONES PENDIENTES DEL CLIENTE, ' +
    'o cuando quiera corregir esos datos. Si falta alguno de los dos, pedíselo antes. Usá el id de la devolución tal ' +
    'cual figura en la lista. No inventes ni completes datos que el cliente no te dio.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      reservationId: {
        type: SchemaType.STRING,
        description: 'El id (uuid) de la devolución pendiente.',
      },
      alias: {
        type: SchemaType.STRING,
        description:
          'El alias de la cuenta, tal cual lo escribió el cliente (por ejemplo "mi.alias.mp").',
      },
      holderName: {
        type: SchemaType.STRING,
        description: 'Nombre completo del titular de la cuenta.',
      },
    },
    required: ['reservationId', 'alias', 'holderName'],
  },
};

const SEND_PAYMENT_LINK_DECLARATION: FunctionDeclaration = {
  name: 'send_payment_link',
  description:
    'Llama a esta función cuando el cliente pregunte cómo, dónde o con qué link pagar la seña de una reserva que ' +
    'ya tomó y todavía no pagó, o pida que le reenvíes el link de pago. Nunca escribas un link de pago por tu cuenta.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      reason: {
        type: SchemaType.STRING,
        description: 'En pocas palabras, qué pidió el cliente.',
      },
    },
  },
};

export interface CancellationContext {
  block: string;
  canCancel: boolean;
  /** Hay devoluciones pendientes del cliente: puede informar o corregir la cuenta. */
  canRegisterRefundAccount?: boolean;
}

export interface RestaurantContext {
  block: string;
  /** Solo un huésped (CA2) con el restó habilitado puede pedir mesa. */
  canBook: boolean;
}

export interface AiResponse {
  action: ChatAction;
  datos?: unknown;
  texto?: string;
}

@Injectable()
export class RagService {
  private genAI: GoogleGenerativeAI;

  constructor(
    private readonly ragRepository: RagRepository,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new Error('Falta GEMINI_API_KEY');
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async ingestDocument(
    rawText: string,
    sourceDocumentId?: string,
  ): Promise<number> {
    const chunks = this.chunkText(rawText, 1000, 200);

    const embeddingModel = this.genAI.getGenerativeModel({
      model: 'gemini-embedding-2',
    });

    let source: { id: string; filename: string; mimeType: string } | undefined;

    if (sourceDocumentId) {
      const doc = await this.ragRepository.findSourceDocument(sourceDocumentId);
      if (!doc) {
        throw new Error(`El documento ${sourceDocumentId} ya no existe`);
      }
      source = { id: doc.id, filename: doc.filename, mimeType: doc.mimeType };
    }

    for (const chunk of chunks) {
      const result = await embeddingModel.embedContent(chunk);
      const embeddingVector = result.embedding.values;
      await this.ragRepository.saveDocumentChunk(
        chunk,
        embeddingVector,
        source,
      );
    }

    return chunks.length;
  }

  async removeDocumentChunks(sourceDocumentId: string): Promise<void> {
    await this.ragRepository.deleteChunksBySourceDocument(sourceDocumentId);
  }

  async askQuestion(
    userQuestion: string,
    reservaActiva: BookingProcess | null = null,
    history: ChatMessage[] = [],
    ultimaCompletada: BookingProcess | null = null,
    servicesBlock: string | null = null,
    cancellation: CancellationContext | null = null,
    hasPendingPayment = false,
    restaurant: RestaurantContext | null = null,
  ): Promise<AiResponse> {
    const embeddingModel = this.genAI.getGenerativeModel({
      model: 'gemini-embedding-2',
    });
    const result = await embeddingModel.embedContent(userQuestion);

    const similarDocs = await this.ragRepository.findSimilar(
      result.embedding.values,
      3,
    );
    const knowledgeText = similarDocs
      .map((doc) => doc.content)
      .join('\n\n---\n\n');
    const contextText = [
      knowledgeText,
      servicesBlock,
      restaurant?.block,
      cancellation?.block,
    ]
      .filter((section): section is string => !!section)
      .join('\n\n---\n\n');

    let contextoReserva = '';
    if (reservaActiva?.step === BookingProcessStep.PENDING_CONFIRMATION) {
      contextoReserva = `\n[ESTADO ACTUAL: Ya le ofreciste la habitación del ${reservaActiva.checkIn} al ${reservaActiva.checkOut} para ${reservaActiva.capacity} persona(s) y estás esperando su respuesta. PROHIBIDO volver a usar 'search_availability' con esos mismos datos. Si el usuario acepta de cualquier forma ("sí", "dale", "ok", "obvio", "perfecto", "me la llevo", "confirmo", un pulgar arriba, etc.), NO vuelvas a buscar disponibilidad ni repitas la oferta: pedile el nombre completo y el DNI del huésped si todavía no los tenés, y en cuanto los tengas usa 'confirm_reservation'. Solo usa 'search_availability' si el usuario pide fechas o cantidad de personas distintas.]`;
    } else if (reservaActiva) {
      contextoReserva = `\n[ESTADO ACTUAL: Faltan datos. CheckIn=${reservaActiva.checkIn || 'No'}, CheckOut=${reservaActiva.checkOut || 'No'}, Capacidad=${reservaActiva.capacity || 'No'}]`;
    } else if (ultimaCompletada) {
      contextoReserva = `\n[ESTADO ACTUAL: La reserva del ${ultimaCompletada.checkIn} al ${ultimaCompletada.checkOut} ya fue tomada y está a la espera del pago de la seña. PROHIBIDO usar las herramientas para estos datos; no le digas al usuario que está confirmada hasta que le avisemos que se acreditó el pago.${hasPendingPayment ? " Si pregunta cómo o dónde pagar la seña, o pide el link, usá 'send_payment_link'." : ''}]`;
    }

    const historyText = this.formatHistory(history);

    const chatModel = this.genAI.getGenerativeModel({
      model: CHAT_MODEL,
      systemInstruction: this.buildSystemInstruction(
        contextText,
        servicesBlock !== null,
        cancellation !== null,
        restaurant !== null,
      ),
      tools: [
        {
          functionDeclarations: [
            {
              name: 'search_availability',
              description: 'Llama a esta función para buscar disponibilidad.',
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  checkIn: {
                    type: SchemaType.STRING,
                    description: 'Fecha entrada DD-MM-YYYY.',
                  },
                  checkOut: {
                    type: SchemaType.STRING,
                    description: 'Fecha salida DD-MM-YYYY.',
                  },
                  capacity: {
                    type: SchemaType.INTEGER,
                    description: 'Cantidad de personas.',
                  },
                },
                required: ['checkIn', 'checkOut', 'capacity'],
              },
            },
            {
              name: 'confirm_reservation',
              description:
                'Llama a esta función ÚNICAMENTE cuando el usuario acepte confirmar la reserva previamente ofrecida Y ya te haya dado su nombre completo y su DNI.',
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  fullName: {
                    type: SchemaType.STRING,
                    description: 'Nombre completo del huésped que se aloja.',
                  },
                  dni: {
                    type: SchemaType.STRING,
                    description: 'Número de DNI del huésped, solo dígitos.',
                  },
                },
                required: ['fullName', 'dni'],
              },
            },
            {
              name: 'request_human',
              description:
                'Llama a esta función cuando el usuario pida hablar con una persona, un recepcionista o un operador humano, ' +
                'o cuando exprese frustración con vos por ser un asistente automático. NO la uses si solo está preguntando ' +
                'por el horario de atención de la recepción o por dónde queda.',
              parameters: {
                type: SchemaType.OBJECT,
                properties: {
                  reason: {
                    type: SchemaType.STRING,
                    description:
                      'En pocas palabras, qué necesita resolver el huésped.',
                  },
                },
                required: ['reason'],
              },
            },
            ...(servicesBlock !== null
              ? [REQUEST_SPA_BOOKING_DECLARATION]
              : []),
            ...(restaurant?.canBook ? [REQUEST_TABLE_BOOKING_DECLARATION] : []),
            ...(cancellation?.canCancel
              ? [CANCEL_RESERVATION_DECLARATION]
              : []),
            ...(cancellation?.canRegisterRefundAccount
              ? [REGISTER_REFUND_ACCOUNT_DECLARATION]
              : []),
            ...(hasPendingPayment ? [SEND_PAYMENT_LINK_DECLARATION] : []),
          ],
        },
      ],
    });

    const prompt = `Historial de la conversación:\n${historyText}\n\nContexto del sistema:\n${contextoReserva}\n\nMensaje del usuario: ${userQuestion}`;

    const chatResponse = await chatModel.generateContent(prompt);

    const [functionCall] = chatResponse.response.functionCalls() || [];

    if (functionCall) {
      const { name, args } = functionCall;

      if (name === 'search_availability')
        return { action: ChatAction.SEARCH_AVAILABILITY, datos: args };
      if (name === 'confirm_reservation') {
        return {
          action: ChatAction.CONFIRM_RESERVATION,
          datos: args,
          texto: chatResponse.response.text(),
        };
      }
      if (name === 'request_human')
        return { action: ChatAction.REQUEST_HUMAN, datos: args };
      if (name === 'cancel_reservation' && cancellation?.canCancel) {
        return { action: ChatAction.CANCEL_RESERVATION, datos: args };
      }
      if (
        name === 'register_refund_account' &&
        cancellation?.canRegisterRefundAccount
      ) {
        return { action: ChatAction.REGISTER_REFUND_ACCOUNT, datos: args };
      }
      if (name === 'send_payment_link' && hasPendingPayment) {
        return { action: ChatAction.SEND_PAYMENT_LINK, datos: args };
      }
      if (name === 'request_spa_booking' && servicesBlock !== null) {
        return {
          action: ChatAction.REQUEST_SPA_BOOKING,
          datos: args,
          texto: chatResponse.response.text(),
        };
      }
      if (name === 'request_table_booking' && restaurant?.canBook) {
        return { action: ChatAction.REQUEST_TABLE_BOOKING, datos: args };
      }
    }

    return { action: ChatAction.REPLY, texto: chatResponse.response.text() };
  }

  async composeUnavailableReply(
    userQuestion: string,
    history: ChatMessage[],
    search: SearchAvailabilityDto,
    alternatives: AlternativeDates[],
  ): Promise<string> {
    const chatModel = this.genAI.getGenerativeModel({
      model: CHAT_MODEL,
      systemInstruction: this.buildSystemInstruction(''),
    });

    const searchResult = JSON.stringify({
      disponibilidad: false,
      solicitud: {
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        capacity: search.capacity,
      },
      alternativas: alternatives,
    });

    const prompt = `Historial de la conversación:\n${this.formatHistory(history)}\n\nMensaje del usuario: ${userQuestion}\n\nResultado de search_availability:\n${searchResult}`;

    const chatResponse = await chatModel.generateContent(prompt);
    return chatResponse.response.text();
  }

  private formatHistory(history: ChatMessage[]): string {
    return history
      .map(
        (msg) => `${HISTORY_SPEAKERS[msg.role] ?? 'Chamber'}: ${msg.content}`,
      )
      .join('\n');
  }

  private buildSystemInstruction(
    contextText: string,
    hasSpaContext = false,
    hasCancellationContext = false,
    hasRestaurantContext = false,
  ): string {
    const restaurantRule = hasRestaurantContext
      ? `REGLA PARA EL RESTAURANTE: Informá sobre el restaurante del hotel usando ÚNICAMENTE la sección [RESTAURANTE] del contexto (carta, precios y horarios) y no inventes platos, precios ni horarios; si un plato no figura en la carta, no está disponible. El restaurante es exclusivo para huéspedes: si la sección dice que el cliente NO es huésped, explicale con amabilidad que es un servicio para huéspedes con reserva confirmada y no le compartas la carta ni le tomes mesa. Si es HUÉSPED, podés ofrecerle el restaurante por tu cuenta una sola vez (si en el historial ya lo ofreciste, no insistas), sin interrumpir lo que esté resolviendo. Si quiere ver el lugar o fotos, compartile el link de FOTOS DEL ESPACIO tal cual figura; si no hay fotos publicadas, decilo. Para pedir mesa necesitás el día (DD-MM-YYYY), la hora (HH:mm) y la cantidad de personas; recién cuando tengas los tres usa 'request_table_booking'. Nunca le digas que la mesa quedó confirmada: la confirma recepción y el sistema le avisa.`
      : `REGLA PARA EL RESTAURANTE: No tenés información del restaurante en este momento. No inventes platos, precios ni horarios; ofrecele derivarlo a recepción.`;

    const cancellationRule = hasCancellationContext
      ? `REGLA PARA CANCELACIONES: Si el cliente pregunta por cancelar, por devoluciones o por la seña, respondé ÚNICAMENTE con la sección [POLÍTICA DE CANCELACIÓN] del contexto (tramos y porcentajes sobre la seña) y no inventes montos ni excepciones. Si quiere cancelar una de sus reservas: identificá cuál (si tiene una sola, es esa), decile con claridad cuánto se le devuelve si cancela hoy (el monto figura en su lista de reservas), avisale que la cancelación no se puede deshacer y preguntale si confirma. Recién cuando te diga que sí de forma explícita usa 'cancel_reservation' con el id de esa reserva. Nunca canceles por tu cuenta ni por una duda como "¿se puede cancelar?". Si en DEVOLUCIONES PENDIENTES DEL CLIENTE una devolución dice FALTA LA CUENTA, pedile al cliente el alias de su cuenta bancaria o billetera virtual y el nombre completo del titular (si ya te dio uno de los dos, pedile solo el otro); cuando tengas los dos usa 'register_refund_account' con el id de esa devolución. Si quiere corregir una cuenta ya informada, también usá 'register_refund_account'. No le digas que la devolución ya se hizo: eso se lo avisa el sistema cuando recepción la transfiere.`
      : `REGLA PARA CANCELACIONES: No tenés información de la política de cancelación en este momento. No prometas devoluciones ni montos; ofrecele derivarlo a recepción.`;

    const servicesRule = hasSpaContext
      ? `REGLA PARA EL SPA: Podés informar y ofrecer el spa a cualquier cliente usando ÚNICAMENTE la sección [SERVICIOS DEL HOTEL] del contexto (nombre, duración, precio, días y horarios). Esa sección te dice si el cliente es HUÉSPED (el spa es SIN CARGO) o EXTERNO (paga el servicio): respetalo y no inventes precios, descuentos ni horarios; si no hay servicios de spa disponibles, decilo. Podés ofrecer el spa por tu cuenta una sola vez (si en el historial ya lo ofreciste, no insistas), sin interrumpir lo que esté resolviendo. Para reservar necesitás el servicio, el día (DD-MM-YYYY) y la hora (HH:mm). Si el cliente es EXTERNO, además pedile su nombre completo y su DNI antes de reservar y avisale que el turno se confirma cuando pague el link de pago que vas a enviarle. Recién cuando tengas todos los datos usa 'request_spa_booking' con el id del servicio. Nunca le digas que el turno quedó confirmado: eso lo informa el sistema (a los huéspedes los confirma recepción y a los externos se confirma al acreditarse el pago).`
      : `REGLA PARA EL SPA: No tenés información del spa en este momento. No inventes servicios, precios ni horarios; ofrecele derivarlo a recepción.`;

    return `Eres Chamber, el asistente virtual del hotel. Estás a entera disposición de los clientes para ayudarles de forma amable, servicial y profesional, manteniendo una charla natural y NO robótica. Responde a la pregunta del usuario utilizando ÚNICAMENTE la siguiente información provista en el contexto. Si la respuesta a una pregunta no está en el contexto, di "Lamentablemente no tengo esa información en este momento, pero puedo derivarte a la recepción"...\n\nFECHA ACTUAL: ${formatDate(new Date())}.\n\nREGLA PARA RESERVAS: Si faltan datos, pregúntalos. Las fechas siempre deben pedirse y enviarse en formato DD-MM-YYYY. Si el usuario no menciona el año, asumí que es el año actual (según la FECHA ACTUAL); si la fecha resultante ya pasó este año, asumí el año siguiente. Cuando tengas los 3 (entrada, salida, capacidad), usa 'search_availability'. Nunca digas que unas fechas están disponibles u ocupadas sin haber usado 'search_availability' con esas fechas en este mismo mensaje: si el usuario pregunta por unas fechas (aunque ya las hayas mencionado antes o le hayas ofrecido otras opciones), volvé a usar 'search_availability' con esas fechas y la cantidad de personas de la conversación. Si ya le ofreciste una habitación y el usuario acepta o confirma explícitamente que quiere reservarla, pedile (si todavía no los tenés) el nombre completo y el DNI del huésped que se aloja antes de confirmar nada; recién cuando tengas esos dos datos usa 'confirm_reservation'. No pidas nombre ni DNI antes de que el usuario haya confirmado que quiere reservar.\n\nREGLA PARA FECHAS ALTERNATIVAS: Si el resultado de 'search_availability' llega con "disponibilidad: false" y un array de "alternativas", cambiá a un tono empático: lamentá que esas fechas no estén disponibles y ofrecé las alternativas con sus fechas exactas (DD-MM-YYYY), la categoría de la habitación y el total de la estadía, sin inventar ni modificar ninguna. Si una alternativa tiene "isShorterStay: true", aclará que es una estadía más corta e indicá cuántas noches son de las pedidas. Cerrá preguntando cuál prefiere. Si en la conversación ya le ofreciste alternativas y el usuario elige una (por ejemplo "la primera" o "la del 12"), usa 'search_availability' con las fechas exactas de esa alternativa y la misma cantidad de personas.\n\nREGLA PARA DERIVAR A UN HUMANO: Si el usuario pide hablar con una persona, un recepcionista, un operador o "alguien de verdad", o se muestra frustrado con vos por ser un asistente automático, usa 'request_human' en vez de contestarle. No la uses si solo está preguntando por el horario o la ubicación de la recepción: eso se responde con el contexto. Tampoco anuncies la derivación por tu cuenta: la función se encarga del mensaje.\n\n${servicesRule}\n\n${restaurantRule}\n\n${cancellationRule}\n\nREGLA SOBRE EL HISTORIAL: Para datos generales del hotel (servicios, horarios, precios, políticas, requisitos), el CONTEXTO es la única fuente de verdad. Si en el historial figura un dato del hotel que no está en el CONTEXTO, o que lo contradice, no lo repitas: respondé según el CONTEXTO o, si no está ahí, decí que no tenés esa información. Esto no aplica a lo que el huésped te contó ni a los datos de su reserva en curso.\n\nCONTEXTO:\n${contextText}`;
  }

  private chunkText(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      const end = i + chunkSize;
      chunks.push(text.substring(i, end));
      i += chunkSize - overlap;
    }
    return chunks;
  }
}
