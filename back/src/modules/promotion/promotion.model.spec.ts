import { PromotionTarget } from '../../infrastructure/database/entities/Promotion.entity';
import {
  buildPromotionLine,
  buildPromotionsBlock,
  describeAmount,
  MAX_PROMOTIONS_IN_BLOCK,
  pickBestPromotion,
  priceWithPromotions,
  PromotionModel,
  PromotionProps,
  PromotionStatus,
  toAppliedPromotion,
} from './promotion.model';

const buildPromotion = (overrides: Partial<PromotionProps> = {}) =>
  new PromotionModel({
    id: 'promo-1',
    title: 'Escapada',
    description: 'Descuento de temporada',
    discountPercentage: 20,
    startDate: '2099-11-10',
    endDate: '2099-11-20',
    target: PromotionTarget.ROOMS,
    minNights: null,
    enabled: true,
    ...overrides,
  });

describe('PromotionModel', () => {
  describe('getStatus (CA3)', () => {
    it.each([
      ['2099-11-09', PromotionStatus.SCHEDULED],
      ['2099-11-10', PromotionStatus.ACTIVE],
      ['2099-11-20', PromotionStatus.ACTIVE],
      ['2099-11-21', PromotionStatus.EXPIRED],
    ])('el %s está %s', (today, status) => {
      expect(buildPromotion().getStatus(today)).toBe(status);
    });

    it('deshabilitada gana sobre las fechas', () => {
      const promotion = buildPromotion({ enabled: false });

      expect(promotion.getStatus('2099-11-15')).toBe(PromotionStatus.DISABLED);
      expect(promotion.getStatus('2099-11-21')).toBe(PromotionStatus.DISABLED);
    });
  });

  describe('getError', () => {
    it('acepta una promoción de un solo día', () => {
      expect(buildPromotion({ endDate: '2099-11-10' }).getError()).toBeNull();
    });

    it('rechaza un fin anterior al inicio', () => {
      expect(buildPromotion({ endDate: '2099-11-09' }).getError()).toMatch(
        /anterior/,
      );
    });

    it('la cantidad mínima de noches solo aplica a habitaciones', () => {
      expect(
        buildPromotion({
          target: PromotionTarget.SPA,
          minNights: 2,
        }).getError(),
      ).toMatch(/noches/);
    });
  });

  describe('appliesTo (CA4)', () => {
    it('exige el mínimo de noches, incluido el borde', () => {
      const promotion = buildPromotion({ minNights: 3 });
      const purchase = { target: PromotionTarget.ROOMS };

      expect(promotion.appliesTo({ ...purchase, nights: 2 })).toBe(false);
      expect(promotion.appliesTo({ ...purchase, nights: 3 })).toBe(true);
    });

    it('no aplica a otra cosa que su destino', () => {
      expect(buildPromotion().appliesTo({ target: PromotionTarget.SPA })).toBe(
        false,
      );
    });
  });
});

describe('pickBestPromotion (CA5)', () => {
  const purchase = { target: PromotionTarget.ROOMS, nights: 2 };

  it('aplica la de mayor beneficio, sin acumular', () => {
    const low = buildPromotion({ id: 'low', discountPercentage: 10 });
    const high = buildPromotion({ id: 'high', discountPercentage: 30 });

    expect(pickBestPromotion([low, high], purchase)).toBe(high);
    expect(priceWithPromotions(1000, [low, high], purchase).finalAmount).toBe(
      700,
    );
  });

  it('descarta la mejor si el huésped no cumple sus condiciones', () => {
    const low = buildPromotion({ id: 'low', discountPercentage: 10 });
    const high = buildPromotion({
      id: 'high',
      discountPercentage: 30,
      minNights: 5,
    });

    expect(pickBestPromotion([high, low], purchase)).toBe(low);
  });

  it('a igual descuento conserva la primera, así el criterio no cambia', () => {
    const first = buildPromotion({ id: 'first' });
    const second = buildPromotion({ id: 'second' });

    expect(pickBestPromotion([first, second], purchase)).toBe(first);
  });

  it('sin promociones que apliquen devuelve null', () => {
    expect(pickBestPromotion([], purchase)).toBeNull();
  });
});

describe('priceWithPromotions', () => {
  const purchase = { target: PromotionTarget.ROOMS, nights: 3 };

  it('sin promoción deja el precio de lista', () => {
    expect(priceWithPromotions(1000, [], purchase)).toEqual({
      listAmount: 1000,
      finalAmount: 1000,
      discountAmount: 0,
      promotion: null,
    });
  });

  it('redondea a centavos', () => {
    const price = priceWithPromotions(
      333.33,
      [buildPromotion({ discountPercentage: 15 })],
      purchase,
    );

    expect(price.discountAmount).toBe(50);
    expect(price.finalAmount).toBe(283.33);
  });

  it('deja registrada una foto de lo que se aplicó', () => {
    const price = priceWithPromotions(1000, [buildPromotion()], purchase);

    expect(toAppliedPromotion(price)).toEqual({
      id: 'promo-1',
      title: 'Escapada',
      percentage: 20,
      discountAmount: 200,
    });
    expect(toAppliedPromotion(priceWithPromotions(1000, [], purchase))).toBe(
      null,
    );
  });
});

describe('textos para el huésped', () => {
  it('la cotización muestra el descuento, el ahorro y las condiciones (CA4)', () => {
    const promotion = buildPromotion({ minNights: 3 });

    expect(buildPromotionLine(promotion)).toBe(
      '🎉 Promoción <b>Escapada</b>: 20% de descuento (mínimo 3 noches, válida hasta el 20-11-2099).',
    );
    expect(
      describeAmount(
        priceWithPromotions(1000, [promotion], {
          target: PromotionTarget.ROOMS,
          nights: 3,
        }),
      ),
    ).toBe('<b>$800</b> (antes $1000, ahorrás $200)');
  });

  it('sin promoción el monto queda igual que siempre', () => {
    expect(
      describeAmount(
        priceWithPromotions(1000, [], { target: PromotionTarget.ROOMS }),
      ),
    ).toBe('$1000');
  });

  it('escapa el título: va en un mensaje con parse_mode HTML', () => {
    expect(buildPromotionLine(buildPromotion({ title: 'A & <B>' }))).toContain(
      '<b>A &amp; &lt;B&gt;</b>',
    );
  });
});

describe('buildPromotionsBlock (CA4)', () => {
  it('lista título, beneficio, destino, vigencia y condiciones', () => {
    const block = buildPromotionsBlock([buildPromotion({ minNights: 2 })]);

    expect(block).toContain('[PROMOCIONES VIGENTES]');
    expect(block).toContain(
      '- Escapada | 20% de descuento | aplica a habitaciones | del 10-11-2099 al 20-11-2099 | mínimo 2 noches',
    );
    expect(block).toContain('Descuento de temporada');
  });

  it('avisa cuando no hay ninguna, para que Chamber no invente', () => {
    expect(buildPromotionsBlock([])).toContain(
      'No hay promociones vigentes en este momento.',
    );
  });

  it('acota la cantidad y el largo para no inflar el prompt', () => {
    const many = Array.from({ length: MAX_PROMOTIONS_IN_BLOCK + 5 }, (_, i) =>
      buildPromotion({ title: `Promo ${i}` }),
    );
    const block = buildPromotionsBlock(many);

    expect(block).toContain(`Promo ${MAX_PROMOTIONS_IN_BLOCK - 1}`);
    expect(block).not.toContain(`Promo ${MAX_PROMOTIONS_IN_BLOCK} `);
    expect(
      buildPromotionsBlock([buildPromotion({ description: 'x'.repeat(900) })])
        .length,
    ).toBeLessThan(500);
  });
});
