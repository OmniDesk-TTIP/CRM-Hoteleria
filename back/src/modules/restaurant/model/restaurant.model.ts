import { v4 } from 'uuid';
import {
  RestaurantShift,
  RestaurantStatus,
} from '../../../infrastructure/database/entities/RestaurantSettings.entity';
import { MenuItemStatus } from '../../../infrastructure/database/entities/RestaurantMenuItem.entity';
import { toMinutes } from '../../supportHours/supportHours.util';
import { describeWeekdays } from '../../spa/model/spa.model';

export const MAX_SHIFTS = 3;

// ───────── Información del restó ─────────

export interface RestaurantSettingsProps {
  id: string;
  status: RestaurantStatus;
  description: string | null;
  availableWeekdays: number[];
  shifts: RestaurantShift[];
  maxPartySize: number;
}

export type RestaurantSettingsChanges = Partial<
  Omit<RestaurantSettingsProps, 'id'>
>;

/**
 * Regla de negocio de la información general del restó. Pura (sin DB ni ORM): el repository la
 * convierte desde y hacia la entidad.
 */
export class RestaurantSettingsModel {
  readonly id: string;
  status: RestaurantStatus;
  description: string | null;
  availableWeekdays: number[];
  shifts: RestaurantShift[];
  maxPartySize: number;

  constructor(props: RestaurantSettingsProps) {
    this.id = props.id;
    this.status = props.status;
    this.description = props.description;
    this.availableWeekdays = [...props.availableWeekdays];
    this.shifts = props.shifts.map((shift) => ({ ...shift }));
    this.maxPartySize = props.maxPartySize;
  }

  /**
   * Lo que se usa mientras el admin todavía no cargó nada: deshabilitado, así Chamber no ofrece
   * un restó sin horarios. Los horarios son una sugerencia para completar el formulario.
   */
  static createDefault(): RestaurantSettingsModel {
    return new RestaurantSettingsModel({
      id: v4(),
      status: RestaurantStatus.INACTIVE,
      description: null,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
      shifts: [
        { opensAt: '12:00', closesAt: '15:00' },
        { opensAt: '20:00', closesAt: '23:30' },
      ],
      maxPartySize: 10,
    });
  }

  isActive(): boolean {
    return this.status === RestaurantStatus.ACTIVE;
  }

  /**
   * ¿Se puede pedir mesa ese día de la semana a esa hora? La hora tiene que caer dentro de una
   * franja; el cierre no cuenta (a la hora de cierre ya no se sienta a nadie).
   */
  isOpenAt(weekday: number, time: string): boolean {
    if (!this.isActive()) return false;
    if (!this.availableWeekdays.includes(weekday)) return false;

    const minutes = toMinutes(time);
    return this.shifts.some(
      (shift) =>
        minutes >= toMinutes(shift.opensAt) &&
        minutes < toMinutes(shift.closesAt),
    );
  }

  /** Aplica cambios parciales. No valida: llamar a `getScheduleError()` después. */
  applyChanges(changes: RestaurantSettingsChanges): void {
    if (changes.status !== undefined) this.status = changes.status;
    if (changes.description !== undefined)
      this.description = changes.description;
    if (changes.availableWeekdays !== undefined)
      this.availableWeekdays = [...changes.availableWeekdays];
    if (changes.shifts !== undefined)
      this.shifts = changes.shifts.map((shift) => ({ ...shift }));
    if (changes.maxPartySize !== undefined)
      this.maxPartySize = changes.maxPartySize;
  }

  /** Devuelve el motivo si la configuración horaria es inconsistente, o null si está bien. */
  getScheduleError(): string | null {
    if (this.maxPartySize < 1) {
      return 'La cantidad máxima de personas por mesa tiene que ser al menos 1';
    }

    const weekdays = this.availableWeekdays;
    if (weekdays.length === 0) {
      return 'El restaurante tiene que abrir al menos un día de la semana';
    }
    if (new Set(weekdays).size !== weekdays.length) {
      return 'Los días de la semana no pueden repetirse';
    }

    if (this.shifts.length === 0) {
      return 'Indicá al menos una franja horaria';
    }
    if (this.shifts.length > MAX_SHIFTS) {
      return `No puede haber más de ${MAX_SHIFTS} franjas horarias`;
    }
    if (
      this.shifts.some(
        (shift) => toMinutes(shift.opensAt) >= toMinutes(shift.closesAt),
      )
    ) {
      return 'En cada franja la hora de cierre tiene que ser posterior a la de apertura';
    }

    const sorted = sortShifts(this.shifts);
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i].opensAt) < toMinutes(sorted[i - 1].closesAt)) {
        return 'Las franjas horarias no pueden superponerse';
      }
    }
    return null;
  }
}

export function sortShifts(shifts: RestaurantShift[]): RestaurantShift[] {
  return [...shifts].sort(
    (a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt),
  );
}

/** "lunes, martes de 12:00 a 15:00 y de 20:00 a 23:30" */
export function describeSchedule(
  settings: Pick<RestaurantSettingsModel, 'availableWeekdays' | 'shifts'>,
): string {
  const shifts = sortShifts(settings.shifts)
    .map((shift) => `de ${shift.opensAt} a ${shift.closesAt}`)
    .join(' y ');
  return `${describeWeekdays(settings.availableWeekdays)} ${shifts}`;
}

// ───────── Carta ─────────

export interface MenuItemProps {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  status: MenuItemStatus;
}

export type MenuItemChanges = Partial<Omit<MenuItemProps, 'id'>>;

export class MenuItemModel {
  readonly id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  status: MenuItemStatus;

  constructor(props: MenuItemProps) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.category = props.category;
    this.price = props.price;
    this.status = props.status;
  }

  static create(
    props: Omit<MenuItemProps, 'id' | 'status' | 'description'> &
      Partial<Pick<MenuItemProps, 'status' | 'description'>>,
  ): MenuItemModel {
    return new MenuItemModel({
      ...props,
      id: v4(),
      description: props.description ?? null,
      status: props.status ?? MenuItemStatus.ACTIVE,
    });
  }

  /** Un ítem deshabilitado no se ofrece en el bot ni se ve en la landing (CA7). */
  isActive(): boolean {
    return this.status === MenuItemStatus.ACTIVE;
  }

  applyChanges(changes: MenuItemChanges): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.description !== undefined)
      this.description = changes.description;
    if (changes.category !== undefined) this.category = changes.category;
    if (changes.price !== undefined) this.price = changes.price;
    if (changes.status !== undefined) this.status = changes.status;
  }
}

export interface MenuSection {
  category: string;
  items: MenuItemModel[];
}

/**
 * Agrupa la carta por sección, respetando el orden en que llegan los ítems (el repository los
 * ordena por sección y nombre). Las secciones se comparan sin distinguir mayúsculas, para que
 * "Postres" y "postres" no aparezcan dos veces.
 */
export function groupMenu(items: MenuItemModel[]): MenuSection[] {
  const sections = new Map<string, MenuSection>();
  for (const item of items) {
    const key = item.category.trim().toLowerCase();
    const section = sections.get(key);
    if (section) section.items.push(item);
    else sections.set(key, { category: item.category.trim(), items: [item] });
  }
  return [...sections.values()];
}

// ───────── Bloque del restó para Chamber (CA2/CA3/CA6/CA7) ─────────

/** Tope de ítems y de largo de descripción para no inflar el prompt de cada mensaje. */
export const MAX_MENU_ITEMS_IN_BLOCK = 60;
export const MAX_MENU_DESCRIPTION_LENGTH = 160;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export interface RestaurantBlockInput {
  /** Configuración guardada, o null si el admin nunca la cargó (restó deshabilitado). */
  settings: RestaurantSettingsModel | null;
  /** Solo ítems activos. */
  menu: MenuItemModel[];
  isGuest: boolean;
  /** Link a la galería de la landing; null si no hay fotos o no está configurada. */
  galleryUrl: string | null;
}

/**
 * Sección `[RESTAURANTE]` del contexto de Chamber. Se arma en cada mensaje desde la DB (no desde
 * el RAG), así lo que el admin deshabilita deja de ofrecerse en la próxima consulta (CA7).
 *
 * El restó es solo para huéspedes con reserva confirmada o alojados (CA2): a los demás no se les
 * pasa la carta, solo que el servicio es exclusivo de huéspedes.
 */
export function buildRestaurantBlock({
  settings,
  menu,
  isGuest,
  galleryUrl,
}: RestaurantBlockInput): string {
  const lines = ['[RESTAURANTE]'];

  if (!settings || !settings.isActive()) {
    lines.push('El restaurante no está disponible por el momento.');
    return lines.join('\n');
  }

  if (!isGuest) {
    lines.push(
      'CLIENTE: NO es huésped. El restaurante es exclusivo para huéspedes con reserva confirmada o alojados en el hotel: no le compartas la carta ni le reserves mesa.',
    );
    return lines.join('\n');
  }

  lines.push(
    'CLIENTE: HUÉSPED del hotel (puede consultar la carta y pedir mesa).',
    `HORARIOS: ${describeSchedule(settings)}.`,
    `MESAS: hasta ${settings.maxPartySize} personas por pedido.`,
  );
  if (settings.description) {
    lines.push(
      `SOBRE EL RESTÓ: ${truncate(settings.description, MAX_MENU_DESCRIPTION_LENGTH * 2)}`,
    );
  }
  lines.push(
    galleryUrl
      ? `FOTOS DEL ESPACIO: ${galleryUrl}`
      : 'FOTOS DEL ESPACIO: no hay fotos publicadas.',
  );

  lines.push('CARTA:');
  if (menu.length === 0) {
    lines.push('- La carta no está cargada por el momento.');
  }
  for (const section of groupMenu(menu.slice(0, MAX_MENU_ITEMS_IN_BLOCK))) {
    lines.push(`${section.category}:`);
    for (const item of section.items) {
      const description = item.description
        ? ` — ${truncate(item.description, MAX_MENU_DESCRIPTION_LENGTH)}`
        : '';
      lines.push(`- ${item.name} | $${item.price}${description}`);
    }
  }

  return lines.join('\n');
}
