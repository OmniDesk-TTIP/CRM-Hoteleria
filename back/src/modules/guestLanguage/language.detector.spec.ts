import { GuestLanguage } from '../../infrastructure/database/entities/ChatSession.entity';
import { detectLanguage } from './language.detector';

describe('detectLanguage', () => {
  it.each([
    'Hello',
    'Hi, do you have rooms available for 2 people?',
    'I want to book a room from 20-11 to 22-11',
    'How much is the breakfast?',
    'Is there parking?',
    'thanks!',
  ])('detecta inglés: %s', (text) => {
    expect(detectLanguage(text)).toBe(GuestLanguage.EN);
  });

  it.each([
    'Hola',
    '¿Tienen habitación para 2 personas?',
    'quiero hacer el check in mas tarde',
    'kiero una abitasion para el sabado',
    'Quiero room service',
    'gracias!',
  ])('detecta español: %s', (text) => {
    expect(detectLanguage(text)).toBe(GuestLanguage.ES);
  });

  it.each(['ok', '👍', '20-11-2026', '2', 'Lautaro Lovato 12345678', ''])(
    'no decide con mensajes neutros: %s',
    (text) => {
      expect(detectLanguage(text)).toBeNull();
    },
  );
});
