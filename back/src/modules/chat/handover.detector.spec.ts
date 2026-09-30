import { detectHumanRequest, isUnresolvedReply } from './handover.detector';

describe('detectHumanRequest', () => {
  describe('pedidos reales de un humano', () => {
    const requests = [
      'quiero hablar con una persona',
      'Quiero hablar con una PERSONA',
      'necesito hablar con un humano',
      'me podés comunicar con el encargado?',
      'pasame con recepción',
      'pasame con un humano por favor',
      'derivame con un recepcionista',
      'quiero hablar con alguien de verdad',
      'sos un bot, quiero que me atienda alguien',
      'necesito un recepcionista',
      'quiero un humano',
      'un humano por favor',
      'no quiero hablar mas con un bot',
      'necesito atención humana',
      'quiero hablar con un operador',
      'me pueden atender con una persona real',
    ];

    it.each(requests)('detecta "%s"', (text) => {
      expect(detectHumanRequest(text)).toBe(true);
    });
  });

  describe('falsos positivos que NO deben derivar', () => {
    const innocuous = [
      '¿a qué hora abre la recepción?',
      '¿cuál es el horario de recepción?',
      'quiero reservar para 3 personas',
      'somos 2 personas',
      'una habitación para dos personas',
      '¿la persona de limpieza pasa todos los días?',
      'el operador turístico me dijo que había promociones',
      '¿el encargado del hotel firma la factura?',
      'hola, quiero reservar del 10-01-2027 al 12-01-2027',
      '¿tienen desayuno incluido?',
      'gracias, muy amable',
      '',
    ];

    it.each(innocuous)('ignora "%s"', (text) => {
      expect(detectHumanRequest(text)).toBe(false);
    });
  });

  it('no depende de tildes ni de mayúsculas', () => {
    expect(detectHumanRequest('QUIERO HABLAR CON UN OPERADOR')).toBe(true);
    expect(detectHumanRequest('quiero hablar con la recepcion')).toBe(true);
  });

  it('tolera emojis y puntuación alrededor del pedido', () => {
    expect(detectHumanRequest('🙏 quiero hablar con una persona!!!')).toBe(true);
  });
});

describe('isUnresolvedReply', () => {
  it.each([
    'Lamentablemente no tengo esa información en este momento, pero puedo derivarte a la recepción.',
    // Respuesta real de Gemini: parafraseó "no entendí" y el contador se reiniciaba.
    'Lamentablemente no entiendo tu consulta. ¿Te puedo ayudar con algo relacionado con el hotel?',
    'No entendí bien tu mensaje',
    'Disculpá, no comprendo lo que me pedís',
    'No cuento con ese dato, te sugiero consultar en recepción',
    'No dispongo de esa información',
    'Disculpá, no pude procesar tu mensaje. ¿Podés reformularlo?',
    '',
  ])('cuenta como sin resolver: "%s"', (reply) => {
    expect(isUnresolvedReply(reply)).toBe(true);
  });

  it.each([
    'Nuestro restaurante está abierto de 12:30 a 23:00 horas.',
    'El check-in es a partir de las 14:00.',
    'La recepción está abierta las 24 horas.',
    '¡Hola! ¿En qué puedo ayudarte hoy?',
  ])('cuenta como resuelta: "%s"', (reply) => {
    expect(isUnresolvedReply(reply)).toBe(false);
  });
});
