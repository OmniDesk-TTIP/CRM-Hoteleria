/** Estados de la reserva, espejo de `ReservationStatus` del back. */
export type ReservationStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';

export interface ReservationSummary {
  id: string;
  checkIn: string;
  checkOut: string;
  roomCategoryName: string;
  guestFullName: string;
  totalAmount: number;
  depositAmount: number;
  status: ReservationStatus;
  initPoint: string | null;
}

export interface PrepaymentFormData {
  guest: string;
  typeRoom: string;
  /** Fecha en formato YYYY-MM-DD. */
  checkIn: string;
  /** Fecha en formato YYYY-MM-DD. */
  checkOut: string;
  totalStay: number;
  advancePayment: number;
  currency?: string;
  reservationCode?: string;
}

export interface PrepaymentFormProps {
  /** Datos del formulario de prepago */
  reservation: PrepaymentFormData;
  alreadyPaid?: boolean;
  onConfirmedPayment?: (reservation: PrepaymentFormData) => Promise<void> | void;
}

export type RoomStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

export type ReservationOrigin = 'BOT' | 'MANUAL';

export interface RoomOption {
  id: string;
  roomNumber: string;
  status: RoomStatus;
  categoryId: string;
  categoryName: string;
  capacity: number;
  basePrice: number;
}

export interface RoomFormData {
  roomNumber: string;
  categoryName: string;
  capacity: number;
  basePrice: number;
  status: RoomStatus;
}

/** Fila de la tabla de reservas del panel de administración. */
export interface AdminReservation {
  id: string;
  guestFullName: string;
  guestDni: string;
  /** Fecha en formato YYYY-MM-DD. */
  checkIn: string;
  checkOut: string;
  status: ReservationStatus;
  origin: ReservationOrigin;
  totalAmount: number;
  depositAmount: number;
  room: {
    id: string;
    roomNumber: string;
    categoryName: string;
  };
  createdAt: string;
  /** US-14: lo que quedó registrado al cancelar. Todo null si la reserva no se canceló. */
  cancelledAt: string | null;
  cancellationPolicyName: string | null;
  refundPercentage: number | null;
  /** Null si no había nada pagado; 0 si la política no devolvía nada. */
  refundAmount: number | null;
  refundStatus: RefundStatus | null;
  /** Cuenta para la devolución que informó el huésped por Telegram. */
  refundAccountAlias: string | null;
  refundAccountHolder: string | null;
}

/* ───────── Cancelaciones y devoluciones (US-14) ───────── */

export type RefundStatus = 'PENDING' | 'COMPLETED';

/** Con al menos `minDaysBeforeCheckIn` días de anticipación se devuelve ese % de la seña. */
export interface CancellationTier {
  minDaysBeforeCheckIn: number;
  refundPercentage: number;
}

export interface CancellationPolicy {
  id: string;
  name: string;
  /** Ordenados de más a menos anticipación. */
  tiers: CancellationTier[];
  /** Solo una política está vigente: es la que se aplica al cancelar. */
  active: boolean;
}

export interface CancellationPolicyFormData {
  name: string;
  tiers: CancellationTier[];
}

/** Fila del listado de devoluciones; `reservationId` identifica la devolución (una por reserva). */
export interface Refund {
  reservationId: string;
  guestFullName: string;
  guestDni: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  amount: number;
  percentage: number;
  policyName: string | null;
  status: RefundStatus;
  cancelledAt: string | null;
  refundedAt: string | null;
  /** Cuenta que informó el huésped por Telegram para la transferencia. */
  accountAlias: string | null;
  accountHolder: string | null;
  /** La reserva vino del bot: al marcarla como realizada se le avisa por Telegram. */
  notifiableByTelegram: boolean;
}

/** Respuesta de marcar una devolución como realizada. */
export interface CompletedRefund extends Refund {
  /** Si el aviso por Telegram le llegó al huésped. */
  guestNotified: boolean;
}

export interface RefundListFilters {
  page: number;
  pageSize: number;
  status: RefundStatus | 'ALL';
}

/** Respuesta paginada genérica de la API. */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type ReservationSortBy = 'checkIn' | 'createdAt' | 'status';
export type SortDirection = 'asc' | 'desc';

/** Filtros y paginación para `GET /reservations` (CA1). */
export interface ReservationListFilters {
  status?: ReservationStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sortBy: ReservationSortBy;
  sortDir: SortDirection;
}

/** Datos que viajan al crear (POST) o editar (PATCH) una reserva manual. */
export interface ReservationFormData {
  guestFullName: string;
  guestDni: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  status: ReservationStatus;
  totalAmount: number;
  depositAmount: number;
}

/* ───────── Auth ───────── */

/** Espejo del enum `UserRole` del back, tal como llega serializado. */
export type UserRole = 'ADMIN' | 'EMPLOYEE';

/** Respuesta de `GET /auth/me` y campo `user` del login (UserDto). */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** ISO 8601: el `Date` de la entidad viaja como string en el JSON. */
  createdAt: string;
}

/**
 * Body exacto de `POST /auth/login`. El ValidationPipe del back usa
 * `forbidNonWhitelisted`, así que un campo de más devuelve 400 en vez de ignorarse.
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  /** Llega como '15m', no en segundos: es el string crudo de JWT_EXPIRES_IN. */
  expiresIn: string;
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: string;
}

/** `checking` dura mientras se intenta restaurar la sesión con la cookie del refresh. */
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  /** Devuelve el usuario para poder decidir el destino sin esperar un render. */
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

export type LoginFieldErrors = Partial<Record<'email' | 'password', string>>;

export interface LoginFormProps {
  /** Si rechaza, el formulario se rehabilita y muestra el error. */
  onLogin: (credentials: LoginCredentials) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* US-11: Handover — intervención manual y derivación a un humano     */
/* ------------------------------------------------------------------ */

/** Espejo de `ChatSessionStatus` del back (`ChatSession.entity.ts`). */
export type ChatSessionStatus = 'BOT' | 'WAITING_HUMAN' | 'HUMAN';

/**
 * Espejo de `MessageRole` (`ChatMessage.entity.ts`). Ojo: no existe 'ADMIN'.
 * `SYSTEM` son los avisos automáticos de transición; `OPERATOR`, lo que escribe
 * un recepcionista desde el panel.
 */
export type MessageRole = 'USER' | 'BOT' | 'SYSTEM' | 'OPERATOR';

/** Por qué se pidió un humano. Espejo de `HandoverReason` del back. */
export type HandoverReason = 'GUEST_REQUEST' | 'AI_FALLBACK' | 'MANUAL_TAKEOVER' | 'OUT_OF_HOURS';

/** Espejo de `BookingProcessStep`, solo lo que el panel muestra del proceso activo. */
export type BookingProcessStep = 'AWAITING_CHECKIN' | 'IN_PROGRESS' | 'PENDING_CONFIRMATION' | 'COMPLETED';

/** Operador asignado a un chat (ChatOperatorDto). */
export interface ChatOperator {
  id: string;
  fullName: string;
}

/** Fila de la bandeja de conversaciones (ChatSummaryDto). */
export interface ChatSummary {
  id: string;
  telegramUserId: string;
  guestDisplayName: string | null;
  telegramUsername: string | null;
  status: ChatSessionStatus;
  assignedOperator: ChatOperator | null;
  /** ISO 8601. */
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageRole: MessageRole | null;
  unreadCount: number;
  /** Distinto de null ⇒ hay un pedido de intervención esperando a un operador (CA1). */
  handoverRequestedAt: string | null;
  handoverReason: HandoverReason | null;
  createdAt: string;
}

/** Reserva en curso del huésped, para dar contexto al operador (ChatActiveBookingDto). */
export interface ChatActiveBooking {
  id: string;
  step: BookingProcessStep;
  /** Texto crudo que el bot le sacó al huésped (varchar libre, suele venir DD-MM-YYYY). */
  checkIn: string | null;
  checkOut: string | null;
  capacity: number | null;
}

/** Detalle de una conversación (ChatDetailDto): el summary más el contexto del handover. */
export interface ChatDetail extends ChatSummary {
  takenOverAt: string | null;
  releasedAt: string | null;
  consecutiveBotFailures: number;
  activeBooking: ChatActiveBooking | null;
  /** Solo llega en la respuesta de `/release`: false si Telegram rechazó el aviso al huésped. */
  guestNotified?: boolean;
}

/** Mensaje del historial (ChatMessageDto). Solo texto: no hay adjuntos ni media. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Solo los mensajes OPERATOR tienen autor. */
  sentBy: ChatOperator | null;
  createdAt: string;
}

/**
 * Página del historial (CursorPageDto). Viene del más nuevo al más viejo, y
 * `nextCursor` es el `createdAt` del más viejo de la página (null si no hay más).
 */
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/** Filtros y paginación de `GET /chats`. */
export interface ChatListFilters {
  status?: ChatSessionStatus | 'ALL';
  /** Solo los que tienen un pedido de intervención pendiente. */
  pendingHandover?: boolean;
  /** Solo los asignados al usuario del token. */
  assignedToMe?: boolean;
  /** Busca en telegramUserId, guestDisplayName y telegramUsername. Máx. 60 caracteres. */
  search?: string;
  page: number;
  pageSize: number;
  sortDir: SortDirection;
}

/* ───────── Eventos del gateway `/ws/chats` ───────── */

/** Parche de la fila de la bandeja que viaja con cada `chat:message`. */
export interface ChatSessionSummaryPatch {
  status: ChatSessionStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface ChatCreatedEvent {
  chat: ChatSummary;
}

export interface ChatMessageEvent {
  chatId: string;
  message: ChatMessage;
  session: ChatSessionSummaryPatch;
}

export interface ChatStatusEvent {
  chatId: string;
  status: ChatSessionStatus;
  previousStatus: ChatSessionStatus;
  assignedOperator: ChatOperator | null;
  reason: HandoverReason | null;
  changedAt: string;
}

export interface ChatReadEvent {
  chatId: string;
  unreadCount: number;
  readBy: ChatOperator;
}

/* ───────── CA5: horarios de atención ───────── */

/** Un día de la semana de la recepción (SupportHoursDayDto). */
export interface SupportHoursDay {
  /** 0 = domingo … 6 = sábado, igual que `Date.getDay()`. */
  weekday: number;
  isClosed: boolean;
  /** Hora en formato HH:mm. */
  opensAt: string;
  closesAt: string;
}

/** Respuesta de `GET /support-hours` y body de `PUT /support-hours`. */
export interface SupportHours {
  /** Siempre los 7 días, ordenados de domingo a sábado. */
  days: SupportHoursDay[];
  timeZone: string;
}

/* ───────── Home / dashboard ───────── */

export type OccupancyCellState = 'free' | 'booked' | 'pending' | 'maintenance';

export interface DashboardAttention {
  /** Chats con un pedido de humano pendiente (mismo criterio que "solo pendientes" de la bandeja). */
  waitingHuman: number;
  myActiveChats: number;
  pendingPayment: number;
  checkInsToday: number;
}

export interface OccupancyRoom {
  id: string;
  roomNumber: string;
  categoryName: string;
  status: RoomStatus;
  /** Un estado por cada día de `DashboardOccupancy.days`. */
  cells: OccupancyCellState[];
}

export interface DashboardOccupancy {
  /** Fechas YYYY-MM-DD, desde hoy. */
  days: string[];
  rooms: OccupancyRoom[];
  occupancyPct: number;
}

export interface DashboardRevenue {
  /** Mes corriente, YYYY-MM. */
  month: string;
  monthTotal: number;
  /** Tarifa promedio por noche vendida en el mes. */
  adr: number;
  monthOccupancyPct: number;
  byMonth: { month: string; total: number }[];
}

export interface DashboardSupport {
  isOpen: boolean;
  /** "mañana a las 09:00"; null si está abierto. */
  nextOpeningLabel: string | null;
}

/** Respuesta de `GET /dashboard/summary`. */
export interface DashboardSummary {
  /** Hoy en la zona horaria del hotel, YYYY-MM-DD. */
  today: string;
  attention: DashboardAttention;
  occupancy: DashboardOccupancy;
  upcomingReservations: AdminReservation[];
  revenue: DashboardRevenue;
  support: DashboardSupport;
}

/** Respuesta de `GET /dashboard/status`: lo que necesita el layout en todas las páginas. */
export interface DashboardStatus {
  waitingHuman: number;
  support: DashboardSupport;
}

/* ───────── Metrics of the bot ───────── */

/** Mismos valores que acepta `GET /statistics?range=`. */
export type StatisticsRange = 'month' | '7d' | 'all';

/** Respuesta de `GET /statistics`. */
export interface BotStatistics {
  range: StatisticsRange;
  /** Primer día del período (YYYY-MM-DD); null en el histórico. */
  from: string | null;
  sales: { total: number; bot: number; manual: number; botPct: number; manualPct: number };
  /** `botDeposits` es la seña cobrada por Mercado Pago; `botTotalValue`, el valor total de esas reservas. */
  revenue: {
    botDeposits: number;
    botTotalValue: number;
    /** US-14: seña retenida de reservas pagadas que se cancelaron (seña menos lo devuelto). */
    cancellationRetained: number;
    /** US-14: devoluciones generadas que todavía no se hicieron. */
    refundsPending: number;
    /** US-14: devoluciones ya realizadas. */
    refundsCompleted: number;
  };
  handover: { totalSessions: number; handedOver: number; ratePct: number };
}

/* ───────── Encuesta de satisfacción (US-18) ───────── */

/** Período de `/surveys` y `/surveys/summary`: días del calendario del hotel, ambos incluidos. */
export interface SurveyPeriod {
  /** YYYY-MM-DD */
  from?: string;
  /** YYYY-MM-DD */
  to?: string;
}

/** Respuesta de un huésped tal como la devuelve `GET /surveys`. Calificaciones de 1 a 5. */
export interface SurveyResponse {
  id: string;
  reservationId: string;
  guestFullName: string;
  roomNumber: string | null;
  /** YYYY-MM-DD */
  checkIn: string | null;
  /** YYYY-MM-DD */
  checkOut: string | null;
  answeredAt: string;
  overallRating: number;
  cleanlinessRating: number;
  attentionRating: number;
  servicesRating: number;
  comment: string | null;
  /** El huésped autorizó mostrar su reseña en la web del hotel. */
  publishConsent: boolean;
  published: boolean;
  publishedAt: string | null;
}

export interface PaginatedSurveyResponses {
  items: SurveyResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** Respuesta de `GET /surveys/summary`. Los promedios son null si no hubo respuestas. */
export interface SurveySummary {
  from: string | null;
  to: string | null;
  responses: number;
  averages: {
    overall: number | null;
    cleanliness: number | null;
    attention: number | null;
    services: number | null;
  };
  /** Encuestas enviadas en el período y cuántas de esas ya se respondieron. */
  invitations: { sent: number; answered: number; responseRatePct: number };
}

/* ───────── Spa y turnos de spa (US-17) ───────── */

export type SpaServiceStatus = 'ACTIVE' | 'INACTIVE';

/** Servicio del spa tal como lo devuelve `GET /spa-services`. */
export interface SpaService {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  /** Precio para clientes externos; los huéspedes no pagan. */
  price: number;
  /** Turnos que pueden estar en curso a la vez. */
  capacity: number;
  status: SpaServiceStatus;
  /** 0 = domingo … 6 = sábado, igual que Date.getDay(). */
  availableWeekdays: number[];
  /** HH:mm */
  opensAt: string;
  /** HH:mm */
  closesAt: string;
}

export interface SpaServiceFormData {
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  capacity: number;
  status: SpaServiceStatus;
  availableWeekdays: number[];
  opensAt: string;
  closesAt: string;
}

/**
 * PENDING espera a recepción (huésped); PENDING_PAYMENT espera el pago (cliente externo).
 * CANCELLED no es una cancelación manual: es el turno de un externo que venció sin pagarse.
 */
export type SpaReservationStatus = 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';

export type SpaReservationClientType = 'GUEST' | 'EXTERNAL';

/** Turno de spa pedido por el chat: el huésped lo confirma recepción, el externo se confirma al pagar. */
export interface SpaReservation {
  id: string;
  status: SpaReservationStatus;
  clientType: SpaReservationClientType;
  serviceName: string;
  guestFullName: string;
  /** YYYY-MM-DD */
  requestedDate: string;
  /** HH:mm */
  requestedTime: string;
  /** Lo que se cobra: 0 para huéspedes. */
  amount: number;
  createdAt: string | null;
}

export interface SpaReservationListFilters {
  status: SpaReservationStatus | 'ALL';
  page: number;
  pageSize: number;
}

export interface PaginatedSpaReservations {
  items: SpaReservation[];
  total: number;
  page: number;
  pageSize: number;
}

/* ───────── Restaurante y pedidos de mesa (US-17) ───────── */

export type RestaurantStatus = 'ACTIVE' | 'INACTIVE';

/** Franja de atención (almuerzo, cena…), en hora del hotel. */
export interface RestaurantShift {
  /** HH:mm */
  opensAt: string;
  /** HH:mm */
  closesAt: string;
}

/** Información del restó tal como la devuelve `GET /restaurant`. */
export interface RestaurantSettings {
  /** false mientras el admin no la guardó nunca: los valores son una sugerencia. */
  configured: boolean;
  status: RestaurantStatus;
  description: string | null;
  /** 0 = domingo … 6 = sábado, igual que Date.getDay(). */
  availableWeekdays: number[];
  shifts: RestaurantShift[];
  maxPartySize: number;
}

export interface RestaurantSettingsFormData {
  status: RestaurantStatus;
  description: string;
  availableWeekdays: number[];
  shifts: RestaurantShift[];
  maxPartySize: number;
}

export type MenuItemStatus = 'ACTIVE' | 'INACTIVE';

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  /** Sección de la carta (Entradas, Principales, Postres…). */
  category: string;
  price: number;
  status: MenuItemStatus;
}

export interface MenuItemFormData {
  name: string;
  description: string;
  category: string;
  price: number;
  status: MenuItemStatus;
}

export interface RestaurantPhoto {
  id: string;
  /** Ruta pública relativa a la URL del back. */
  url: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
}

export type RestaurantReservationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

/** Pedido de mesa hecho por el chat; lo confirma o rechaza recepción. */
export interface RestaurantReservation {
  id: string;
  status: RestaurantReservationStatus;
  guestFullName: string;
  /** YYYY-MM-DD */
  requestedDate: string;
  /** HH:mm */
  requestedTime: string;
  partySize: number;
  notes: string | null;
  createdAt: string | null;
}

export interface RestaurantReservationListFilters {
  status: RestaurantReservationStatus | 'ALL';
  page: number;
  pageSize: number;
}

export interface PaginatedRestaurantReservations {
  items: RestaurantReservation[];
  total: number;
  page: number;
  pageSize: number;
}

/* ───────── US: Administración de reglas base (base de conocimiento) ───────── */

export type KnowledgeDocumentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR';
export type KnowledgeDocumentType = 'PDF' | 'TXT';

export interface KnowledgeDocument {
  id: string;
  filename: string;
  mimeType: string;
  type: KnowledgeDocumentType;
  sizeBytes: number;
  status: KnowledgeDocumentStatus;
  chunksCount: number;
  errorMessage?: string;
  /** ISO 8601. */
  createdAt: string;
}