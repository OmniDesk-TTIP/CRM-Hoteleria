import { groupMenu, MenuItemModel } from '../restaurant/model/restaurant.model';
import { SpaServiceModel } from '../spa/model/spa.model';
import { escapeHtml, htmlLink } from '../telegram/telegram.format';

export enum MenuPdfKind {
  RESTAURANT = 'restaurant',
  ROOM_SERVICE = 'room-service',
  SPA = 'spa',
}

export const isMenuPdfKind = (value: unknown): value is MenuPdfKind =>
  Object.values(MenuPdfKind).includes(value as MenuPdfKind);

interface MenuPdfTexts {
  title: string;
  filename: string;
  label: string;
  unavailable: string;
  notEligible: string;
  empty: string;
}

export const MENU_PDF_TEXTS: Record<MenuPdfKind, MenuPdfTexts> = {
  [MenuPdfKind.RESTAURANT]: {
    title: 'Carta del restó',
    filename: 'carta-resto.pdf',
    label: 'la carta del restó',
    unavailable: 'El restaurante no está disponible por el momento.',
    notEligible:
      'La carta del restó es para huéspedes con reserva confirmada o alojados en el hotel.',
    empty:
      'La carta del restó no tiene platos habilitados por el momento, así que no hay PDF para enviar.',
  },
  [MenuPdfKind.ROOM_SERVICE]: {
    title: 'Carta de room service',
    filename: 'carta-room-service.pdf',
    label: 'la carta de room service',
    unavailable: 'El room service no está disponible por el momento.',
    notEligible:
      'La carta de room service es para huéspedes alojados en el hotel.',
    empty:
      'La carta de room service no tiene platos habilitados por el momento, así que no hay PDF para enviar.',
  },
  [MenuPdfKind.SPA]: {
    title: 'Servicios del spa',
    filename: 'servicios-spa.pdf',
    label: 'los servicios del spa',
    unavailable: 'El spa no está disponible por el momento.',
    notEligible:
      'El PDF de servicios del spa es para huéspedes con reserva confirmada o alojados en el hotel.',
    empty:
      'El spa no tiene servicios habilitados por el momento, así que no hay PDF para enviar.',
  },
};

export const SPA_SECTION_TITLE = 'Tratamientos';
export const SPA_PRICE_NOTE =
  'Sin cargo para huéspedes del hotel. Los precios aplican a visitantes externos.';

export interface MenuPdfItem {
  name: string;
  description: string | null;
  price: number;
  /** Solo en el spa. */
  durationMinutes?: number;
}

export interface MenuPdfSection {
  category: string;
  items: MenuPdfItem[];
}

export interface MenuPdfSource {
  enabled: boolean;
  schedule: string | null;
  note: string | null;
  sections: MenuPdfSection[];
}

export interface MenuPdfContent extends MenuPdfSource {
  kind: MenuPdfKind;
  title: string;
  hotelName: string;
  updatedOn: string;
}

export interface MenuPdfFile {
  source: Buffer;
  filename: string;
}

export function menuSections(items: MenuItemModel[]): MenuPdfSection[] {
  return groupMenu(items).map(({ category, items: sectionItems }) => ({
    category,
    items: sectionItems.map(({ name, description, price }) => ({
      name,
      description,
      price,
    })),
  }));
}

export function spaSections(services: SpaServiceModel[]): MenuPdfSection[] {
  if (services.length === 0) return [];
  return [
    {
      category: SPA_SECTION_TITLE,
      items: services.map(({ name, description, price, durationMinutes }) => ({
        name,
        description,
        price,
        durationMinutes,
      })),
    },
  ];
}

export function buildMenuPdfContent(
  kind: MenuPdfKind,
  source: MenuPdfSource,
  hotelName: string,
  today: string,
): MenuPdfContent {
  const [year, month, day] = today.split('-');
  return {
    ...source,
    kind,
    title: MENU_PDF_TEXTS[kind].title,
    hotelName,
    updatedOn: `${day}/${month}/${year}`,
  };
}

export const hasItems = (content: MenuPdfSource): boolean =>
  content.sections.some((section) => section.items.length > 0);

export const formatPrice = (price: number): string =>
  `$ ${price.toLocaleString('es-AR', {
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

export const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

export const formatDuration = (minutes: number): string => `${minutes} min`;

export function buildGuestReply(
  content: MenuPdfContent,
  landingUrl: string | null,
): string {
  const { label } = MENU_PDF_TEXTS[content.kind];
  const categories = content.sections.map(({ category }) => category);
  const lines = [
    `Te envío el PDF con ${label} para que lo tengas a mano.`,
    categories.length > 1
      ? `Vas a encontrar: ${escapeHtml(categories.join(', '))}.`
      : null,
    content.schedule ? `Horarios: ${escapeHtml(content.schedule)}.` : null,
    landingUrl
      ? `También lo encontrás en ${htmlLink(landingUrl, 'nuestra web')}.`
      : null,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
