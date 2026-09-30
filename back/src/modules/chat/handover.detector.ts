const HUMAN_TARGET =
  String.raw`(?:ser\s+humano|persona\s+real|persona|humano|humana|alguien\s+(?:real|de\s+verdad)|alguien|` +
  String.raw`recepcionista|recepcion|operador|operadora|encargado|encargada|agente|empleado|empleada|` +
  String.raw`gerente|responsable)`;

const CONTACT_VERB =
  String.raw`(?:hablar|hablo|charlar|conversar|comunicar(?:me|te|nos)?|comunicame|contactar(?:me)?|` +
  String.raw`contactame|conectar(?:me)?|derivar(?:me)?|derivame|transferir(?:me)?|pasar(?:me)?|pasame|` +
  String.raw`pasenme|atender(?:me)?|atiendame|atienda|atiendan)`;

const PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`\b${CONTACT_VERB}\b[^.?!\n]{0,30}?\bcon\s+(?:un|una|el|la|algun|alguna)?\s*${HUMAN_TARGET}\b`,
  ),
  new RegExp(
    String.raw`\b(?:quiero|necesito|dame|deme|denme|requiero|solicito)\s+(?:un|una)\s+${HUMAN_TARGET}\b`,
  ),

  // Rechazo explícito del bot.
  /\b(?:sos|eres|es)\s+un\s+bot\b/,
  /\bno\s+(?:quiero|pienso)\s+(?:hablar|seguir)\b[^.?!\n]{0,20}\bbot\b/,
  /\bbasta\s+de\s+bot\b/,
  /\b(?:un|una)\s+(?:humano|humana|persona)\s*,?\s*por\s+favor\b/,

  // "atención humana", "operador humano", "soporte humano"
  /\b(?:atencion|soporte|asistencia|operador|agente)\s+humano?a?\b/,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectHumanRequest(text: string): boolean {
  if (!text) return false;

  const normalized = normalize(text);
  return PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Gemini parafrasea aunque el prompt le dicte la frase exacta ("no entiendo" en vez de
 * "no entendí", "no cuento con ese dato"...), así que se buscan familias de frases y no
 * textos fijos.
 */
const UNRESOLVED_PATTERNS: RegExp[] = [
  /\bno\s+(?:tengo|cuento\s+con|dispongo\s+de|encuentro)\s+(?:esa|esta|la|ese|este|el|dicha)?\s*(?:informacion|info|dato)\b/,
  /\bno\s+(?:entiendo|entendi|comprendo|comprendi|logro\s+entender|pude\s+entender)\b/,
  /\bderivarte\s+(?:a|con)\s+(?:la\s+)?recepcion\b/,
  /\bno\s+pude\s+procesar\b/,
  /\bpodes\s+reformular/,
];

//Alimenta el contador de fallos consecutivos que levanta la bandera de intervenir.
export function isUnresolvedReply(reply: string): boolean {
  if (!reply) return true;

  const normalized = normalize(reply);
  return UNRESOLVED_PATTERNS.some((pattern) => pattern.test(normalized));
}
