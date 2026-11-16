import { ArrivalMessageStatus } from '../../infrastructure/database/entities/ArrivalMessage.entity';
import { classifySendError } from '../campaign/campaign.model';
import { DaySchedule, toMinutes } from '../supportHours/supportHours.util';

export const DEFAULT_CHECK_IN_TIME = '13:00';
export const WELCOME_SEND_AFTER = '09:00';
export const DEFAULT_ARRIVAL_INFO =
  'Estamos en el centro de la ciudad, a 4 cuadras de la plaza principal. Tenemos estacionamiento subterráneo gratuito para huéspedes y, si necesitás transfer desde el aeropuerto, lo reservás en recepción con al menos 24 horas de anticipación.';

export interface WelcomeInfo {
  checkInTime: string;
  /** Horario de la recepción de hoy; null si no hay horarios cargados. */
  reception: Pick<DaySchedule, 'isClosed' | 'opensAt' | 'closesAt'> | null;
  roomService: { opensAt: string; closesAt: string } | null;
  /** Nombres de los servicios de spa que atienden hoy. */
  spaServices: string[];
  /** Horarios del restó; null si hoy no abre. */
  restaurantSchedule: string | null;
}

/**
 * CA1: el recordatorio sale desde 24 hs antes del check-in, o sea el día anterior a partir del
 * horario de ingreso. Si se confirma después, sale igual hasta la medianoche: el día de la llegada
 * ya le toca a la bienvenida.
 */
export function isReminderDue(
  nowMinutes: number,
  checkInTime: string,
): boolean {
  return nowMinutes >= toMinutes(checkInTime);
}

export function isWelcomeDue(nowMinutes: number): boolean {
  return nowMinutes >= toMinutes(WELCOME_SEND_AFTER);
}

export function failureStatusOf(error: unknown): ArrivalMessageStatus {
  return classifySendError(error).kind === 'BLOCKED'
    ? ArrivalMessageStatus.BLOCKED
    : ArrivalMessageStatus.FAILED;
}

const firstNameOf = (guestFullName: string): string =>
  guestFullName.trim().split(/\s+/)[0];

const toChatDay = (day: string): string => day.split('-').reverse().join('-');

export function buildReminderMessage(
  guestFullName: string,
  checkInDay: string,
  checkInTime: string,
  arrivalInfo: string,
): string {
  return [
    `¡Hola ${firstNameOf(guestFullName)}! Soy Chamber. Mañana te esperamos en el hotel.`,
    '',
    `📅 Llegada: ${toChatDay(checkInDay)}`,
    `🕐 Check-in: a partir de las ${checkInTime}`,
    '',
    `Cómo llegar: ${arrivalInfo}`,
    '',
    'Si necesitás algo antes de tu llegada, escribime por acá.',
  ].join('\n');
}

function describeReception(reception: WelcomeInfo['reception']): string[] {
  if (!reception) return [];
  return [
    reception.isClosed
      ? '• Recepción: hoy está cerrada'
      : `• Recepción: hoy de ${reception.opensAt} a ${reception.closesAt}`,
  ];
}

export function buildWelcomeMessage(
  guestFullName: string,
  info: WelcomeInfo,
): string {
  const { checkInTime, reception, roomService, spaServices } = info;
  const { restaurantSchedule } = info;

  const offers = [
    ...(spaServices.length > 0
      ? [`• Spa, sin cargo para huéspedes: ${spaServices.join(', ')}`]
      : []),
    ...(restaurantSchedule ? [`• Restó: ${restaurantSchedule}`] : []),
  ];
  const bookable = [
    ...(spaServices.length > 0 ? ['un turno de spa'] : []),
    ...(restaurantSchedule ? ['una mesa en el restó'] : []),
  ];

  return [
    `¡Hola ${firstNameOf(guestFullName)}! Hoy es tu llegada: te damos la bienvenida.`,
    '',
    'Para tu ingreso:',
    `• Check-in: a partir de las ${checkInTime}`,
    ...describeReception(reception),
    ...(roomService
      ? [`• Room service: de ${roomService.opensAt} a ${roomService.closesAt}`]
      : []),
    ...(offers.length > 0 ? ['', 'Durante tu estadía:', ...offers] : []),
    '',
    bookable.length > 0
      ? `Si querés ${bookable.join(' o ')}, pedímelo por acá. Para cualquier otra consulta también estoy acá.`
      : 'Para cualquier consulta, escribime por acá.',
  ].join('\n');
}
