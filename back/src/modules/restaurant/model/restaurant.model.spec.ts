import { RestaurantStatus } from '../../../infrastructure/database/entities/RestaurantSettings.entity';
import { MenuItemStatus } from '../../../infrastructure/database/entities/RestaurantMenuItem.entity';
import {
  buildRestaurantBlock,
  describeSchedule,
  groupMenu,
  MenuItemModel,
  RestaurantSettingsModel,
} from './restaurant.model';
import { detectImageType, isSamePhotoSet } from './restaurantPhoto.model';

const buildSettings = (
  overrides: Partial<
    ConstructorParameters<typeof RestaurantSettingsModel>[0]
  > = {},
) =>
  new RestaurantSettingsModel({
    id: 'settings-1',
    status: RestaurantStatus.ACTIVE,
    description: null,
    availableWeekdays: [1, 2, 3, 4, 5],
    shifts: [
      { opensAt: '20:00', closesAt: '23:30' },
      { opensAt: '12:00', closesAt: '15:00' },
    ],
    maxPartySize: 8,
    ...overrides,
  });

const item = (name: string, category: string, price = 1000) =>
  MenuItemModel.create({ name, category, price });

describe('RestaurantSettingsModel', () => {
  it('arranca deshabilitado si el admin nunca lo configuró', () => {
    expect(RestaurantSettingsModel.createDefault().isActive()).toBe(false);
  });

  describe('isOpenAt', () => {
    const settings = buildSettings();

    it('acepta horarios dentro de cualquiera de las franjas', () => {
      expect(settings.isOpenAt(1, '12:00')).toBe(true);
      expect(settings.isOpenAt(1, '21:30')).toBe(true);
    });

    it('rechaza la hora de cierre, entre franjas y fuera de los días', () => {
      expect(settings.isOpenAt(1, '15:00')).toBe(false);
      expect(settings.isOpenAt(1, '17:00')).toBe(false);
      expect(settings.isOpenAt(0, '13:00')).toBe(false);
    });

    it('rechaza todo si el restó está deshabilitado (CA7)', () => {
      const closed = buildSettings({ status: RestaurantStatus.INACTIVE });
      expect(closed.isOpenAt(1, '13:00')).toBe(false);
    });
  });

  describe('getScheduleError', () => {
    it('acepta una configuración válida', () => {
      expect(buildSettings().getScheduleError()).toBeNull();
    });

    it.each([
      [{ availableWeekdays: [] }, 'al menos un día'],
      [{ availableWeekdays: [1, 1] }, 'no pueden repetirse'],
      [{ shifts: [] }, 'al menos una franja'],
      [{ shifts: [{ opensAt: '15:00', closesAt: '12:00' }] }, 'posterior'],
      [
        {
          shifts: [
            { opensAt: '12:00', closesAt: '16:00' },
            { opensAt: '15:00', closesAt: '18:00' },
          ],
        },
        'superponerse',
      ],
      [{ maxPartySize: 0 }, 'al menos 1'],
    ])('rechaza %o', (overrides, message) => {
      expect(buildSettings(overrides).getScheduleError()).toContain(message);
    });

    it('acepta franjas que se tocan sin superponerse', () => {
      const settings = buildSettings({
        shifts: [
          { opensAt: '12:00', closesAt: '15:00' },
          { opensAt: '15:00', closesAt: '18:00' },
        ],
      });
      expect(settings.getScheduleError()).toBeNull();
    });
  });

  it('describe el horario con las franjas en orden', () => {
    expect(describeSchedule(buildSettings())).toBe(
      'lunes, martes, miércoles, jueves, viernes de 12:00 a 15:00 y de 20:00 a 23:30',
    );
  });
});

describe('groupMenu', () => {
  it('agrupa por sección sin duplicarlas por mayúsculas y respeta el orden', () => {
    const sections = groupMenu([
      item('Flan', 'Postres'),
      item('Helado', 'postres '),
      item('Milanesa', 'Principales'),
    ]);

    expect(sections.map((s) => s.category)).toEqual(['Postres', 'Principales']);
    expect(sections[0].items.map((i) => i.name)).toEqual(['Flan', 'Helado']);
  });
});

describe('buildRestaurantBlock', () => {
  const menu = [
    item('Milanesa', 'Principales', 9000),
    MenuItemModel.create({
      name: 'Flan',
      category: 'Postres',
      price: 3500,
      description: 'Con dulce de leche',
    }),
  ];

  it('al huésped le pasa horarios, carta con precios y link de fotos (CA3/CA6)', () => {
    const block = buildRestaurantBlock({
      settings: buildSettings({ description: 'Cocina de autor' }),
      menu,
      isGuest: true,
      galleryUrl: 'https://hotel.test/restaurante',
    });

    expect(block).toContain('[RESTAURANTE]');
    expect(block).toContain('HUÉSPED');
    expect(block).toContain('de 12:00 a 15:00 y de 20:00 a 23:30');
    expect(block).toContain('hasta 8 personas');
    expect(block).toContain('Cocina de autor');
    expect(block).toContain('- Milanesa | $9000');
    expect(block).toContain('- Flan | $3500 — Con dulce de leche');
    expect(block).toContain(
      'FOTOS DEL ESPACIO: https://hotel.test/restaurante',
    );
  });

  it('avisa si no hay fotos publicadas', () => {
    const block = buildRestaurantBlock({
      settings: buildSettings(),
      menu,
      isGuest: true,
      galleryUrl: null,
    });
    expect(block).toContain('no hay fotos publicadas');
  });

  it('al que no es huésped no le pasa la carta (CA2)', () => {
    const block = buildRestaurantBlock({
      settings: buildSettings(),
      menu,
      isGuest: false,
      galleryUrl: 'https://hotel.test/restaurante',
    });

    expect(block).toContain('NO es huésped');
    expect(block).not.toContain('Milanesa');
    expect(block).not.toContain('https://hotel.test');
  });

  it('con el restó deshabilitado no ofrece nada (CA7)', () => {
    for (const settings of [
      null,
      buildSettings({ status: RestaurantStatus.INACTIVE }),
    ]) {
      const block = buildRestaurantBlock({
        settings,
        menu,
        isGuest: true,
        galleryUrl: null,
      });
      expect(block).toContain('no está disponible');
      expect(block).not.toContain('Milanesa');
    }
  });
});

describe('MenuItemModel', () => {
  it('se crea activo y sin descripción por defecto', () => {
    const created = item('Agua', 'Bebidas');
    expect(created.status).toBe(MenuItemStatus.ACTIVE);
    expect(created.description).toBeNull();
  });
});

describe('fotos', () => {
  it('reconoce JPEG, PNG y WebP por su contenido', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe('image/png');
    expect(
      detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary')),
    ).toBe('image/webp');
  });

  it('rechaza lo que no es una imagen soportada aunque diga serlo', () => {
    expect(detectImageType(Buffer.from('<svg onload="alert(1)">'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
  });

  it('solo acepta un orden con exactamente las fotos actuales', () => {
    expect(isSamePhotoSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isSamePhotoSet(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(isSamePhotoSet(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(isSamePhotoSet(['a', 'b'], ['a', 'x'])).toBe(false);
  });
});
