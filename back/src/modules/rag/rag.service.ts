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
  REPLY = 'REPLY',
}

const REQUEST_SPA_BOOKING_DECLARATION: FunctionDeclaration = {
  name: 'request_spa_booking',
  description:
    'Llama a esta función cuando el huésped quiera un turno de spa y ya te haya indicado qué servicio, ' +
    'qué día y a qué hora. Si falta alguno de esos datos, preguntáselo antes. Usá el id del servicio tal ' +
    'cual figura en [SERVICIOS DEL HOTEL].',
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
    },
    required: ['serviceId', 'date', 'time'],
  },
};

/** Lo que decidió el modelo: responder texto o disparar una acción con sus argumentos sin validar. */
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

  async ingestDocument(rawText: string): Promise<void> {
    const chunks = this.chunkText(rawText, 1000, 200);

    const embeddingModel = this.genAI.getGenerativeModel({
      model: 'gemini-embedding-2',
    });

    for (const chunk of chunks) {
      const result = await embeddingModel.embedContent(chunk);
      const embeddingVector = result.embedding.values;

      await this.ragRepository.saveDocumentChunk(chunk, embeddingVector);
    }
  }

  async askQuestion(
    userQuestion: string,
    reservaActiva: BookingProcess | null = null,
    history: ChatMessage[] = [],
    ultimaCompletada: BookingProcess | null = null,
    servicesBlock: string | null = null,
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
    // Los servicios del hotel (solo para huespedes elegibles) vienen de la DB, no del RAG.
    const contextText = servicesBlock
      ? `${knowledgeText}\n\n---\n\n${servicesBlock}`
      : knowledgeText;

    let contextoReserva = '';
    if (reservaActiva?.step === BookingProcessStep.PENDING_CONFIRMATION) {
      contextoReserva = `\n[ESTADO ACTUAL: Ya le ofreciste la habitación del ${reservaActiva.checkIn} al ${reservaActiva.checkOut} para ${reservaActiva.capacity} persona(s) y estás esperando su respuesta. PROHIBIDO volver a usar 'search_availability' con esos mismos datos. Si el usuario acepta de cualquier forma ("sí", "dale", "ok", "obvio", "perfecto", "me la llevo", "confirmo", un pulgar arriba, etc.), NO vuelvas a buscar disponibilidad ni repitas la oferta: pedile el nombre completo y el DNI del huésped si todavía no los tenés, y en cuanto los tengas usa 'confirm_reservation'. Solo usa 'search_availability' si el usuario pide fechas o cantidad de personas distintas.]`;
    } else if (reservaActiva) {
      contextoReserva = `\n[ESTADO ACTUAL: Faltan datos. CheckIn=${reservaActiva.checkIn || 'No'}, CheckOut=${reservaActiva.checkOut || 'No'}, Capacidad=${reservaActiva.capacity || 'No'}]`;
    } else if (ultimaCompletada) {
      contextoReserva = `\n[ESTADO ACTUAL: La reserva del ${ultimaCompletada.checkIn} al ${ultimaCompletada.checkOut} ya fue tomada y está a la espera del pago de la seña. PROHIBIDO usar las herramientas para estos datos; no le digas al usuario que está confirmada hasta que le avisemos que se acreditó el pago.]`;
    }

    const historyText = this.formatHistory(history);

    const chatModel = this.genAI.getGenerativeModel({
      model: CHAT_MODEL,
      systemInstruction: this.buildSystemInstruction(
        contextText,
        servicesBlock !== null,
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
            // Solo para huéspedes elegibles (CA2); el service lo vuelve a validar.
            ...(servicesBlock !== null
              ? [REQUEST_SPA_BOOKING_DECLARATION]
              : []),
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
      if (name === 'request_spa_booking' && servicesBlock !== null) {
        return {
          action: ChatAction.REQUEST_SPA_BOOKING,
          datos: args,
          texto: chatResponse.response.text(),
        };
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
    guestHasServices = false,
  ): string {
    const servicesRule = guestHasServices
      ? `REGLA PARA SERVICIOS DEL HOTEL: Este huésped tiene una reserva confirmada o está alojado, así que podés informarle y ofrecerle el spa usando ÚNICAMENTE lo que figura en la sección [SERVICIOS DEL HOTEL] del contexto (nombre, duración, precio, días y horarios). No inventes servicios, precios ni horarios; si no hay servicios de spa disponibles, decilo. Podés ofrecerle el spa por tu cuenta una sola vez (si en el historial ya se lo ofreciste, no insistas), sin interrumpir lo que esté resolviendo. Si quiere un turno, asegurate de tener el servicio, el día (DD-MM-YYYY) y la hora (HH:mm); recién entonces usa 'request_spa_booking' con el id del servicio. Es una solicitud que recepción confirma después: nunca le digas que el turno quedó confirmado.`
      : `REGLA PARA SERVICIOS DEL HOTEL: El spa es un servicio exclusivo para huéspedes con reserva confirmada o alojados, y con este usuario no tenés esa verificación. No ofrezcas el spa ni des precios u horarios. Si pregunta por él, explicale que es para huéspedes con reserva confirmada y que puede reservar su habitación con vos.`;

    return `Eres Chamber, el asistente virtual del hotel. Estás a entera disposición de los clientes para ayudarles de forma amable, servicial y profesional, manteniendo una charla natural y NO robótica. Responde a la pregunta del usuario utilizando ÚNICAMENTE la siguiente información provista en el contexto. Si la respuesta a una pregunta no está en el contexto, di "Lamentablemente no tengo esa información en este momento, pero puedo derivarte a la recepción"...\n\nFECHA ACTUAL: ${formatDate(new Date())}.\n\nREGLA PARA RESERVAS: Si faltan datos, pregúntalos. Las fechas siempre deben pedirse y enviarse en formato DD-MM-YYYY. Si el usuario no menciona el año, asumí que es el año actual (según la FECHA ACTUAL); si la fecha resultante ya pasó este año, asumí el año siguiente. Cuando tengas los 3 (entrada, salida, capacidad), usa 'search_availability'. Si ya le ofreciste una habitación y el usuario acepta o confirma explícitamente que quiere reservarla, pedile (si todavía no los tenés) el nombre completo y el DNI del huésped que se aloja antes de confirmar nada; recién cuando tengas esos dos datos usa 'confirm_reservation'. No pidas nombre ni DNI antes de que el usuario haya confirmado que quiere reservar.\n\nREGLA PARA FECHAS ALTERNATIVAS: Si el resultado de 'search_availability' llega con "disponibilidad: false" y un array de "alternativas", cambiá a un tono empático: lamentá que esas fechas no estén disponibles y ofrecé las alternativas con sus fechas exactas (DD-MM-YYYY), la categoría de la habitación y el total de la estadía, sin inventar ni modificar ninguna. Si una alternativa tiene "isShorterStay: true", aclará que es una estadía más corta e indicá cuántas noches son de las pedidas. Cerrá preguntando cuál prefiere. Si en la conversación ya le ofreciste alternativas y el usuario elige una (por ejemplo "la primera" o "la del 12"), usa 'search_availability' con las fechas exactas de esa alternativa y la misma cantidad de personas.\n\nREGLA PARA DERIVAR A UN HUMANO: Si el usuario pide hablar con una persona, un recepcionista, un operador o "alguien de verdad", o se muestra frustrado con vos por ser un asistente automático, usa 'request_human' en vez de contestarle. No la uses si solo está preguntando por el horario o la ubicación de la recepción: eso se responde con el contexto. Tampoco anuncies la derivación por tu cuenta: la función se encarga del mensaje.\n\n${servicesRule}\n\nCONTEXTO:\n${contextText}`;
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
