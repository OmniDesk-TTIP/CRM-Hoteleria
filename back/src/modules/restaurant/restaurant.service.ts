import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaService } from '../spa/spa.service';
import { RestaurantRepository } from './restaurant.repository';
import { RestaurantPhotoRepository } from './restaurantPhoto.repository';
import {
  buildRestaurantBlock,
  MenuItemModel,
  RestaurantSettingsModel,
} from './model/restaurant.model';
import { UpdateRestaurantSettingsDto } from './dto/updateRestaurantSettings.dto';
import { CreateMenuItemDto, UpdateMenuItemDto } from './dto/menuItem.dto';
import { PublicRestaurantDto, toPublicRestaurant } from './dto/restaurant.dto';

export interface RestaurantChatContext {
  block: string;
  canBook: boolean;
}

const DEFAULT_LANDING_RESTAURANT_PATH = '/restaurante';

const toNullableText = (
  value: string | undefined,
): string | null | undefined =>
  value === undefined ? undefined : value.trim() || null;

@Injectable()
export class RestaurantService {
  constructor(
    private readonly restaurantRepository: RestaurantRepository,
    private readonly photoRepository: RestaurantPhotoRepository,
    private readonly spaService: SpaService,
    private readonly configService: ConfigService,
  ) {}

  // ───────── Información (CA1) ─────────

  async getSettings(): Promise<{
    settings: RestaurantSettingsModel;
    configured: boolean;
  }> {
    const saved = await this.restaurantRepository.findSettings();
    return saved
      ? { settings: saved, configured: true }
      : {
          settings: RestaurantSettingsModel.createDefault(),
          configured: false,
        };
  }

  async updateSettings(
    payload: UpdateRestaurantSettingsDto,
  ): Promise<RestaurantSettingsModel> {
    const { settings } = await this.getSettings();

    settings.applyChanges({
      status: payload.status,
      description: toNullableText(payload.description) ?? null,
      availableWeekdays: payload.availableWeekdays,
      shifts: payload.shifts.map(({ opensAt, closesAt }) => ({
        opensAt,
        closesAt,
      })),
      maxPartySize: payload.maxPartySize,
      roomServiceEnabled: payload.roomServiceEnabled,
      roomServiceOpensAt: payload.roomServiceOpensAt,
      roomServiceClosesAt: payload.roomServiceClosesAt,
    });
    const error = settings.getScheduleError();
    if (error) throw new BadRequestException(error);

    await this.restaurantRepository.saveSettings(settings);
    return settings;
  }

  // ───────── Carta (CA1/CA7) ─────────

  listMenuItems(): Promise<MenuItemModel[]> {
    return this.restaurantRepository.findAllMenuItems();
  }

  async createMenuItem(payload: CreateMenuItemDto): Promise<MenuItemModel> {
    await this.assertMenuNameIsFree(payload.name);

    const model = MenuItemModel.create({
      ...payload,
      description: toNullableText(payload.description) ?? null,
    });
    await this.restaurantRepository.insertMenuItem(model);
    return model;
  }

  async updateMenuItem(
    id: string,
    payload: UpdateMenuItemDto,
  ): Promise<MenuItemModel> {
    const model = await this.getMenuItemOrFail(id);

    if (
      payload.name &&
      payload.name.toLowerCase() !== model.name.toLowerCase()
    ) {
      await this.assertMenuNameIsFree(payload.name, id);
    }

    model.applyChanges({
      ...payload,
      description: toNullableText(payload.description),
    });
    await this.restaurantRepository.updateMenuItem(model);
    return model;
  }

  async removeMenuItem(id: string): Promise<void> {
    await this.getMenuItemOrFail(id);
    await this.restaurantRepository.deleteMenuItem(id);
  }

  /** US-24: la carta de room service (platos habilitados y marcados para la habitación). */
  listRoomServiceMenu(): Promise<MenuItemModel[]> {
    return this.restaurantRepository.findRoomServiceMenuItems();
  }

  // ───────── Chamber (CA2/CA3/CA6/CA7) ─────────

  async getChatContext(telegramUserId: string): Promise<RestaurantChatContext> {
    const settings = await this.restaurantRepository.findSettings();
    const isActive = settings?.isActive() ?? false;
    const isGuest =
      isActive &&
      (await this.spaService.findEligibleStay(telegramUserId)) !== null;

    const [menu, photoCount] = isGuest
      ? await Promise.all([
          this.restaurantRepository.findActiveMenuItems(),
          this.photoRepository.count(),
        ])
      : [[], 0];

    return {
      block: buildRestaurantBlock({
        settings,
        menu,
        isGuest,
        galleryUrl: photoCount > 0 ? this.getGalleryUrl() : null,
      }),
      canBook: isActive && isGuest,
    };
  }

  getGalleryUrl(): string | null {
    const explicit = this.configService.get<string>('RESTAURANT_GALLERY_URL');
    if (explicit) return explicit;

    const landing = this.configService.get<string>('LANDING_BASE_URL');
    return landing
      ? `${landing.replace(/\/+$/, '')}${DEFAULT_LANDING_RESTAURANT_PATH}`
      : null;
  }

  // ───────── Landing (CA1/CA6/CA7) ─────────

  async getPublicInfo(): Promise<PublicRestaurantDto> {
    const settings = await this.restaurantRepository.findSettings();
    if (!settings?.isActive()) return toPublicRestaurant(null, [], []);

    const [menu, photos] = await Promise.all([
      this.restaurantRepository.findActiveMenuItems(),
      this.photoRepository.findAll(),
    ]);
    return toPublicRestaurant(settings, menu, photos);
  }

  private async getMenuItemOrFail(id: string): Promise<MenuItemModel> {
    const model = await this.restaurantRepository.findMenuItemById(id);
    if (!model) throw new NotFoundException('Ítem de la carta no encontrado');
    return model;
  }

  private async assertMenuNameIsFree(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.restaurantRepository.findMenuItemByName(
      name,
      excludeId,
    );
    if (existing) {
      throw new ConflictException(
        'Ya existe un ítem de la carta con ese nombre',
      );
    }
  }
}
