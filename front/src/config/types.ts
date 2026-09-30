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
  /** Marca la seña como ya abonada (reserva confirmada antes de entrar a la pantalla). */
  alreadyPaid?: boolean;
  /** Se ejecuta al confirmar el pago. Si rechaza la promesa, el form vuelve a habilitarse. */
  onConfirmedPayment?: (reservation: PrepaymentFormData) => Promise<void> | void;
}

/** Espejo de `RoomStatus` del back (`Room.entity.ts`). */
export type RoomStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

/** De dónde vino la reserva: generada por el bot de Telegram o cargada a mano (CA4). */
export type ReservationOrigin = 'BOT' | 'MANUAL';

/** Habitación disponible para asignar, con su categoría ya resuelta (para el selector del form). */
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
  /** Fecha en formato YYYY-MM-DD. */
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
