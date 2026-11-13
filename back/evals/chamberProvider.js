// Provider de promptfoo para Chamber: le manda los mensajes del caso al endpoint de evals del back
// (POST /eval/conversation) y le devuelve a promptfoo la respuesta final del bot.
//
// - `output`   → lo que contestó el bot en el último turno. Sobre esto corren contains, llm-rubric, etc.
// - `metadata` → todo lo demás (acción elegida, turnos, estado de la reserva y del chat).
//                Las aserciones `javascript` lo leen como `context.metadata`.

class ChamberProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'chamber-bot';
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    // Cada línea no vacía de `mensajes` es un mensaje del huésped, en orden.
    // (Se usa un texto multilínea y no una lista porque promptfoo expande las listas en varios tests.)
    const messages = String(context?.vars?.mensajes ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (messages.length === 0) {
      return { error: 'El caso no tiene `mensajes`' };
    }

    const baseUrl = process.env.EVAL_BASE_URL || 'http://localhost:3000';
    let response;
    try {
      response = await fetch(`${baseUrl}/eval/conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-eval-key': process.env.EVAL_API_KEY || '',
        },
        body: JSON.stringify({ messages }),
      });
    } catch (error) {
      return {
        error: `No se pudo conectar con ${baseUrl} (¿está levantado el back?): ${error}`,
      };
    }

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${await response.text()}` };
    }

    const data = await response.json();

    // Si el bot falló en algún turno (Gemini caído, excepción), el caso se marca como ERROR y no
    // como FAIL: no es que el bot contestó mal, es que no pudo contestar.
    const failedTurn = data.turns.find((turn) => turn.kind === 'error');
    if (failedTurn) {
      return {
        error: `El bot falló con "${failedTurn.message}": ${failedTurn.error}`,
        metadata: data,
      };
    }

    return {
      output: data.final.reply,
      latencyMs: data.totalLatencyMs,
      metadata: data,
    };
  }
}

module.exports = ChamberProvider;
