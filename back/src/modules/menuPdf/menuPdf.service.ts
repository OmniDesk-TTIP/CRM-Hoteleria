import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RestaurantService } from '../restaurant/restaurant.service';
import { describeSchedule } from '../restaurant/model/restaurant.model';
import { RoomServiceService } from '../roomService/roomService.service';
import { describeRoomServiceHours } from '../roomService/roomService.model';
import { SpaService } from '../spa/spa.service';
import {
  buildGuestReply,
  buildMenuPdfContent,
  capitalize,
  hasItems,
  MENU_PDF_TEXTS,
  MenuPdfContent,
  MenuPdfFile,
  MenuPdfKind,
  MenuPdfSource,
  menuSections,
  SPA_PRICE_NOTE,
  spaSections,
} from './menuPdf.model';
import { renderMenuPdf } from './menuPdf.renderer';

export type GuestMenuPdfResult =
  | { ok: true; reply: string; document: MenuPdfFile }
  | { ok: false; reason: string };

const DEFAULT_HOTEL_NAME = 'Alma Hotel';

// US-25. El PDF se genera en cada pedido con lo que hay cargado en el panel: no se guarda ni se
// cachea, así los cambios se ven en el siguiente envío sin desplegar nada (CA3).
@Injectable()
export class MenuPdfService {
  constructor(
    private readonly restaurantService: RestaurantService,
    private readonly roomServiceService: RoomServiceService,
    private readonly spaService: SpaService,
    private readonly configService: ConfigService,
  ) {}

  /** CA8: el administrador previsualiza la carta aunque el servicio todavía esté deshabilitado. */
  async buildForAdmin(
    kind: MenuPdfKind,
    now: Date = new Date(),
  ): Promise<MenuPdfFile> {
    const content = await this.loadContent(kind, now);
    if (!hasItems(content)) {
      throw new ConflictException(MENU_PDF_TEXTS[kind].empty);
    }
    return this.toFile(content);
  }

  /** CA1/CA6/CA7: el PDF para el huésped, o el motivo por el que no se le envía. */
  async buildForGuest(
    kind: MenuPdfKind,
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<GuestMenuPdfResult> {
    const texts = MENU_PDF_TEXTS[kind];

    if (!(await this.isEligible(kind, telegramUserId, now))) {
      return { ok: false, reason: texts.notEligible };
    }

    const content = await this.loadContent(kind, now);
    if (!content.enabled) return { ok: false, reason: texts.unavailable };
    if (!hasItems(content)) return { ok: false, reason: texts.empty };

    return {
      ok: true,
      reply: buildGuestReply(content, this.getLandingUrl(kind)),
      document: await this.toFile(content),
    };
  }

  /** CA6: room service solo para alojados; restó y spa también con reserva confirmada. */
  private async isEligible(
    kind: MenuPdfKind,
    telegramUserId: string,
    now: Date,
  ): Promise<boolean> {
    const stay =
      kind === MenuPdfKind.ROOM_SERVICE
        ? await this.roomServiceService.findCurrentStay(telegramUserId, now)
        : await this.spaService.findEligibleStay(telegramUserId, now);
    return stay !== null;
  }

  private async loadContent(
    kind: MenuPdfKind,
    now: Date,
  ): Promise<MenuPdfContent> {
    return buildMenuPdfContent(
      kind,
      await this.loadSource(kind),
      this.configService.get<string>('HOTEL_NAME') || DEFAULT_HOTEL_NAME,
      this.spaService.getHotelClock(now).today,
    );
  }

  private loadSource(kind: MenuPdfKind): Promise<MenuPdfSource> {
    switch (kind) {
      case MenuPdfKind.RESTAURANT:
        return this.loadRestaurant();
      case MenuPdfKind.ROOM_SERVICE:
        return this.loadRoomService();
      case MenuPdfKind.SPA:
        return this.loadSpa();
    }
  }

  private async loadRestaurant(): Promise<MenuPdfSource> {
    const { settings } = await this.restaurantService.getSettings();
    return {
      enabled: settings.isActive(),
      schedule: capitalize(describeSchedule(settings)),
      note: null,
      sections: menuSections(await this.restaurantService.listActiveMenu()),
    };
  }

  private async loadRoomService(): Promise<MenuPdfSource> {
    const { settings } = await this.restaurantService.getSettings();
    return {
      enabled: settings.roomServiceEnabled,
      schedule: capitalize(
        describeRoomServiceHours({
          enabled: settings.roomServiceEnabled,
          opensAt: settings.roomServiceOpensAt,
          closesAt: settings.roomServiceClosesAt,
        }),
      ),
      note: null,
      sections: menuSections(
        await this.restaurantService.listRoomServiceMenu(),
      ),
    };
  }

  private async loadSpa(): Promise<MenuPdfSource> {
    return {
      enabled: true,
      schedule: null,
      note: SPA_PRICE_NOTE,
      sections: spaSections(await this.spaService.listActive()),
    };
  }

  private getLandingUrl(kind: MenuPdfKind): string | null {
    return kind === MenuPdfKind.RESTAURANT
      ? this.restaurantService.getGalleryUrl()
      : this.configService.get<string>('LANDING_BASE_URL') || null;
  }

  private async toFile(content: MenuPdfContent): Promise<MenuPdfFile> {
    return {
      source: await renderMenuPdf(content),
      filename: MENU_PDF_TEXTS[content.kind].filename,
    };
  }
}
