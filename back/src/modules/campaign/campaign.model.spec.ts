import {
  buildCampaignText,
  buildChatNotice,
  detectImageType,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_LENGTH,
  maxMessageLength,
  validateCampaignLength,
} from './campaign.model';

describe('campaign.model', () => {
  describe('buildCampaignText', () => {
    it('pone el título en negrita y escapa el HTML que escriba el administrador', () => {
      expect(buildCampaignText('2x1 <spa>', 'Hasta el 30 & más')).toBe(
        '<b>2x1 &lt;spa&gt;</b>\n\nHasta el 30 &amp; más',
      );
    });
  });

  describe('validateCampaignLength', () => {
    const title = 'Promo';

    it('sin imagen admite hasta 4096 caracteres entre título y mensaje', () => {
      const max = maxMessageLength(title, false);
      expect(max).toBe(MAX_TEXT_LENGTH - title.length - 2);
      expect(validateCampaignLength(title, 'a'.repeat(max), false)).toBeNull();
      expect(validateCampaignLength(title, 'a'.repeat(max + 1), false)).toMatch(
        /4096/,
      );
    });

    it('con imagen el texto va como pie de foto y el límite baja a 1024', () => {
      const max = maxMessageLength(title, true);
      expect(max).toBe(MAX_CAPTION_LENGTH - title.length - 2);
      expect(validateCampaignLength(title, 'a'.repeat(max), true)).toBeNull();
      expect(validateCampaignLength(title, 'a'.repeat(max + 1), true)).toMatch(
        /1024/,
      );
    });

    it('cuenta el texto sin escapar, que es como lo cuenta Telegram', () => {
      const max = maxMessageLength(title, true);
      expect(validateCampaignLength(title, '&'.repeat(max), true)).toBeNull();
    });
  });

  describe('detectImageType', () => {
    it('reconoce JPG, PNG y WEBP por sus primeros bytes', () => {
      expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
        'jpeg',
      );
      expect(
        detectImageType(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        ),
      ).toBe('png');
      expect(
        detectImageType(
          Buffer.concat([
            Buffer.from('RIFF'),
            Buffer.from([0, 0, 0, 0]),
            Buffer.from('WEBP'),
          ]),
        ),
      ).toBe('webp');
    });

    it('rechaza cualquier otra cosa aunque el nombre diga .jpg', () => {
      expect(detectImageType(Buffer.from('%PDF-1.7'))).toBeUndefined();
      expect(detectImageType(Buffer.from('GIF89a'))).toBeUndefined();
      expect(detectImageType(Buffer.alloc(0))).toBeUndefined();
    });
  });

  describe('buildChatNotice', () => {
    it('deja título y mensaje para que Chamber tenga contexto si el huésped responde', () => {
      expect(buildChatNotice('Promo', 'Detalle', true)).toBe(
        '📣 Campaña enviada (con imagen): «Promo»\nDetalle',
      );
      expect(buildChatNotice('Promo', 'Detalle', false)).toBe(
        '📣 Campaña enviada: «Promo»\nDetalle',
      );
    });
  });
});
