import { MenuItemModel } from '../restaurant/model/restaurant.model';
import { SpaServiceModel } from '../spa/model/spa.model';
import {
  buildGuestReply,
  buildMenuPdfContent,
  formatPrice,
  hasItems,
  isMenuPdfKind,
  MenuPdfKind,
  MenuPdfSource,
  menuSections,
  SPA_SECTION_TITLE,
  spaSections,
} from './menuPdf.model';
import { renderMenuPdf } from './menuPdf.renderer';

const dish = (name: string, category: string, price = 1000) =>
  MenuItemModel.create({ name, category, price, description: `Rico ${name}` });

const massage = (name: string, durationMinutes = 60) =>
  SpaServiceModel.create({
    name,
    description: 'Relajante',
    durationMinutes,
    price: 20000,
    availableWeekdays: [1, 2, 3],
    opensAt: '10:00',
    closesAt: '20:00',
  });

const source = (overrides: Partial<MenuPdfSource> = {}): MenuPdfSource => ({
  enabled: true,
  schedule: 'Todos los días de 12:00 a 15:00',
  note: null,
  sections: menuSections([
    dish('Provoleta', 'Entradas', 8500),
    dish('Ojo de bife', 'Principales', 24500.5),
  ]),
  ...overrides,
});

describe('menuPdf.model', () => {
  it.each([
    ['restaurant', true],
    ['room-service', true],
    ['spa', true],
    ['bar', false],
    [undefined, false],
  ])('isMenuPdfKind(%p) es %p', (value, expected) => {
    expect(isMenuPdfKind(value)).toBe(expected);
  });

  it('organiza la carta por categorías con nombre, descripción y precio (CA2/CA4)', () => {
    const sections = menuSections([
      dish('Provoleta', 'Entradas', 8500),
      dish('Empanadas', 'entradas ', 6200),
      dish('Flan', 'Postres', 5200),
    ]);

    expect(sections.map(({ category }) => category)).toEqual([
      'Entradas',
      'Postres',
    ]);
    expect(sections[0].items).toEqual([
      { name: 'Provoleta', description: 'Rico Provoleta', price: 8500 },
      { name: 'Empanadas', description: 'Rico Empanadas', price: 6200 },
    ]);
  });

  it('los servicios del spa van en una sección e incluyen la duración (CA2)', () => {
    const [section] = spaSections([massage('Masaje', 45)]);

    expect(section.category).toBe(SPA_SECTION_TITLE);
    expect(section.items).toEqual([
      {
        name: 'Masaje',
        description: 'Relajante',
        price: 20000,
        durationMinutes: 45,
      },
    ]);
  });

  it('sin ítems habilitados no hay secciones (CA7)', () => {
    expect(spaSections([])).toEqual([]);
    expect(hasItems(source({ sections: menuSections([]) }))).toBe(false);
    expect(hasItems(source())).toBe(true);
  });

  it('el contenido lleva el nombre del hotel, el título y la fecha de actualización (CA5)', () => {
    const content = buildMenuPdfContent(
      MenuPdfKind.ROOM_SERVICE,
      source(),
      'Alma Hotel',
      '2099-03-05',
    );

    expect(content).toMatchObject({
      kind: MenuPdfKind.ROOM_SERVICE,
      title: 'Carta de room service',
      hotelName: 'Alma Hotel',
      updatedOn: '05/03/2099',
      schedule: 'Todos los días de 12:00 a 15:00',
    });
  });

  it.each([
    [8500, '$ 8.500'],
    [24500.5, '$ 24.500,50'],
  ])('formatea el precio %p como %p', (price, expected) => {
    expect(formatPrice(price)).toBe(expected);
  });

  describe('respuesta que acompaña al PDF (CA1)', () => {
    const content = buildMenuPdfContent(
      MenuPdfKind.RESTAURANT,
      source(),
      'Alma Hotel',
      '2099-03-05',
    );

    it('resume la carta y comparte el link de la landing', () => {
      const reply = buildGuestReply(content, 'https://hotel.test/restaurante');

      expect(reply).toContain('la carta del restó');
      expect(reply).toContain('Entradas, Principales');
      expect(reply).toContain('Horarios: Todos los días de 12:00 a 15:00.');
      expect(reply).toContain('<a href="https://hotel.test/restaurante">');
    });

    it('sin landing configurada no inventa un link', () => {
      expect(buildGuestReply(content, null)).not.toContain('<a href');
    });
  });

  describe('PDF generado', () => {
    const render = (overrides: Partial<MenuPdfSource> = {}) =>
      renderMenuPdf(
        buildMenuPdfContent(
          MenuPdfKind.RESTAURANT,
          source(overrides),
          'Alma Hotel',
          '2099-03-05',
        ),
      );
    // Los diccionarios de página no van comprimidos: alcanza con contarlos en el archivo.
    const pagesOf = (pdf: Buffer) =>
      pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

    it('es un PDF válido de una página', async () => {
      const pdf = await render();
      const raw = pdf.toString('latin1');

      expect(raw.startsWith('%PDF-')).toBe(true);
      expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(pagesOf(pdf)).toBe(1);
    });

    it('una carta larga se reparte en varias páginas', async () => {
      const many = Array.from({ length: 60 }, (_, index) =>
        dish(`Plato ${index + 1}`, `Categoría ${index % 4}`),
      );

      expect(
        pagesOf(await render({ sections: menuSections(many) })),
      ).toBeGreaterThan(1);
    });

    it('no se rompe con emojis ni con un ítem sin descripción', async () => {
      const sections = [
        {
          category: 'Bebidas 🍷',
          items: [{ name: 'Malbec 🍇', description: null, price: 5400 }],
        },
      ];

      expect(pagesOf(await render({ sections, schedule: null }))).toBe(1);
    });
  });
});
