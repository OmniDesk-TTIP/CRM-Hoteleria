# Evals del bot (Chamber)

Evals **offline** con [promptfoo](https://promptfoo.dev): se le manda al bot un set fijo de
mensajes (el *dataset*) y se chequea qué contesta, qué acción elige y cuánto tarda.

No son tests de Jest: el bot usa Gemini de verdad y escribe en la base, así que **gastan tokens**.
Se corren a mano (antes de mergear un cambio en el prompt, el RAG o un flujo), no en cada `npm test`.

## Cómo funciona

```
promptfoo ──> evals/chamberProvider.js ──HTTP──> POST /eval/conversation ──> BotService ──> Gemini
                                                      (EvalController)       (la misma lógica
                                                                               que usa Telegram)
```

- `src/modules/bot/bot.service.ts`: la lógica del bot, independiente de Telegram.
- `src/modules/eval/eval.controller.ts`: el endpoint. Solo existe si está `EVAL_API_KEY` y pide
  esa clave en el header `x-eval-key`. Cada request usa un huésped nuevo (`eval-<uuid>`).
- `evals/chamberProvider.js`: le pasa los mensajes del caso al endpoint y devuelve la respuesta.
- `evals/datasets/*.yaml`: los casos.

## Correrlo

1. **Base local** levantada (`docker compose up -d`) con los datos del hotel cargados.
   ⚠️ No usar la base de producción: las evals crean chats y reservas de prueba.
2. En `back/.env`:
   ```env
   EVAL_API_KEY=cualquier-clave-local
   TELEGRAM_POLLING=false        # el back no recibe mensajes de Telegram (ver paso 3)
   GEMINI_API_KEY=...            # ya está: la usa el bot y también el juez de los llm-rubric
   # EVAL_BASE_URL=http://localhost:3000   # opcional, ese es el default
   # PROMPTFOO_DISABLE_TELEMETRY=1        # opcional
   ```
3. Levantar el back: `npm run start:dev`.
   Con `TELEGRAM_POLLING=false` el back no se conecta a Telegram para recibir mensajes, así que no
   le roba los mensajes a otra instancia (la deployada o la de un compañero) que use el mismo token.
   Si la base es vieja, primero `npx mikro-orm migration:up`.
4. Correr las evals: `npm run eval`
5. Ver los resultados en el navegador: `npm run eval:view`

Para correr solo algunos casos (y gastar menos): `npm run eval -- --filter-pattern "Reserva"`.
Para re-correr solo los que fallaron: `npm run eval -- --filter-failing <id de la corrida>`.
Para medir casos inestables: `npm run eval -- --repeat 3` (gasta 3 veces más).

## Agregar un caso

En `datasets/faq.yaml` (preguntas sueltas) o `datasets/flujos.yaml` (flujos), o en un archivo
nuevo que se suma en `tests:` de `promptfooconfig.yaml`:

```yaml
- description: 'Spa: horario'          # nombre que aparece en la tabla
  vars:
    mensajes: |                         # una línea = un mensaje del huésped
      Hola
      ¿A qué hora abre el spa?
  assert:
    - type: icontains                   # sin tokens: el texto contiene "9"
      value: '9'
      metric: correctitud
    - type: javascript                  # sin tokens: mira la metadata del endpoint
      value: context.metadata.final.action === 'REPLY'
      metric: accion
    - type: llm-rubric                  # con tokens: un LLM juez puntúa la respuesta
      value: Dice el horario del spa y no inventa servicios.
      metric: correctitud
```

Qué hay en `context.metadata` (lo que devuelve el endpoint):

| Campo | Qué es |
|---|---|
| `final.reply` | Última respuesta del bot (también es el `output`) |
| `final.action` | Acción que eligió Gemini: `REPLY`, `SEARCH_AVAILABILITY`, `SEND_MENU_PDF`... |
| `final.kind` | `reply`, `handover`, `muted`, `discarded` o `error` |
| `final.buttons` / `final.document` | Botones y PDF que se mandaron |
| `turns[]` | Lo mismo para cada mensaje, con `latencyMs` |
| `state.chatStatus` | `BOT`, `WAITING_HUMAN` o `HUMAN` |
| `state.activeBooking` | Reserva en curso (`step`, `checkIn`, `checkOut`, `capacity`) o `null` |

Preferí siempre las aserciones sin tokens (`icontains`, `javascript`) y usá `llm-rubric` solo
para lo que no se puede chequear con código (tono, si inventó algo, idioma).
