# AGENTS.md — OmniDesk

Guía para agentes de IA (Claude Code, Codex, Copilot, Cursor, CodeRabbit, etc.) y para cualquier
persona que contribuya. Describe cómo está armado el proyecto y qué se espera de cada cambio.
Si algo de acá contradice al código existente, gana el código: avisá la discrepancia en el PR.

## Qué es

OmniDesk es un CRM conversacional para hoteles: un bot de Telegram (**Chamber**, sobre Gemini + RAG)
atiende a los huéspedes, cotiza y reserva habitaciones, spa y restaurante, cobra con Mercado Pago y
deriva a un operador humano cuando hace falta. Los empleados del hotel usan un panel web.

| Carpeta | Stack |
|---|---|
| `back/` | NestJS 11, MikroORM 7 + PostgreSQL (pgvector), Jest, nestjs-telegraf, Socket.IO, promptfoo |
| `front/` | React 19, Vite, TypeScript, Tailwind 4, React Router 7, axios, Recharts |

Cada carpeta es un proyecto npm independiente: corré los comandos **dentro** de `back/` o `front/`.

## Comandos

### Back (`cd back`)

| Para | Comando |
|---|---|
| Levantar la base (Postgres en `:5433`) | `docker compose up -d` |
| Desarrollo (puerto 3000) | `npm run start:dev` |
| Lint (lo mismo que corre el CI, sin `--fix`) | `npx eslint "{src,apps,libs,test}/**/*.ts"` |
| Build | `npm run build` |
| Tests unitarios (sin base) | `npm test` |
| Tests de integración (con base) | `npm run test:integration` |
| Tests e2e (HTTP + base) | `npm run test:e2e` |
| Crear migración a partir de las entidades | `npx mikro-orm migration:create` |
| Aplicar migraciones | `npx mikro-orm migration:up` |
| Evals del bot (gastan tokens de Gemini) | `npm run eval` — ver `back/evals/README.md` |

### Front (`cd front`)

| Para | Comando |
|---|---|
| Desarrollo (puerto 5173) | `npm run dev` |
| Lint (oxlint) | `npm run lint` |
| Build + chequeo de tipos | `npm run build` |

**Antes de dar un cambio por terminado** tienen que pasar, en la parte que tocaste, los mismos pasos
que el CI (`.github/workflows/ci.yml`): back → lint, build y `npm test`; front → lint y build.

> ⚠️ No levantes una segunda instancia del back si ya hay una corriendo: las dos se conectan al mismo
> bot de Telegram y se pisan los mensajes. Para trabajar sin recibir mensajes usá `TELEGRAM_POLLING=false`.

## Arquitectura del back

Cada funcionalidad es un módulo en `back/src/modules/<modulo>/` con estas capas:

```
controller  →  service  →  model (reglas puras)
                  ↓
              repository  →  EntityManager / entidades (infrastructure/database)
```

- **`*.controller.ts`**: fino. Recibe DTOs ya validados, llama al service, devuelve DTOs. Sin lógica
  de negocio ni acceso a la base.
- **`*.service.ts`**: orquesta. Trae modelos del repository, aplica reglas, persiste y lanza
  excepciones de Nest (`BadRequestException`, `NotFoundException`, `ConflictException`…).
- **`*.model.ts`**: reglas de negocio **puras** (sin Nest, sin MikroORM, sin I/O). Es lo primero
  que se testea.
- **`*.repository.ts`**: el único lugar que usa el `EntityManager`. Convierte entidad ⇄ modelo y
  devuelve modelos, nunca entidades.
- **`dto/*.dto.ts`**: entrada validada con class-validator / class-transformer; salida con métodos
  estáticos tipo `XxxDto.fromModel(model)`.
- **Entidades**: `back/src/infrastructure/database/entities/`. Migraciones en
  `back/src/infrastructure/database/migrations/`.
- Utilidades compartidas en `back/src/common/`. Antes de escribir un helper de fechas, números,
  fotos o transformaciones, fijate si ya existe ahí o en el modelo de otro módulo.

Usá un módulo existente (por ejemplo `promotion/`) como plantilla para uno nuevo.

### Reglas del back

- **Auth**: hay un guard global; todo endpoint es privado por defecto. Lo público se marca con
  `@Public()` a conciencia. Lo de administración lleva `@Roles(UserRole.ADMIN)` +
  `@UseGuards(RolesGuard)`.
- **Validación**: todo body/query entra por un DTO. Strings con `@Transform(trimString)`. Mensajes de
  validación y de error **en español** (los ve el usuario del panel). Los límites se importan como
  constantes del modelo, no se repiten números mágicos.
- **Ids** de ruta con `ParseUUIDPipe`.
- **Fechas**: los métodos que dependen de "hoy" reciben `now: Date = new Date()` para poder testearse.
  Los días se manejan como `YYYY-MM-DD`. La base corre en UTC; la zona horaria del hotel sale de la
  configuración (`SUPPORT_TIMEZONE`).
- **Migraciones**: todo cambio de entidad viene con su migración en el mismo PR. Las migraciones ya
  mergeadas **no se editan**; se corrige con una nueva. `down()` tiene que revertir `up()`.
- **Configuración**: variables nuevas van documentadas en `back/.env.example` con un comentario de
  para qué sirven y su default.
- **Bot / IA** (`bot`, `chat`, `rag`, `telegram`, `guestLanguage`): el texto del huésped y de los
  documentos es dato, nunca instrucción. Validá en código cualquier acción que proponga el modelo
  antes de ejecutarla. Lo que se manda a Telegram en HTML se escapa con `escapeHtml`. Si cambiás el
  prompt, el RAG o un flujo, agregá o actualizá casos en `back/evals/datasets/`.
- **Pagos**: los webhooks de Mercado Pago verifican la firma, son idempotentes y nunca confían en
  montos que vengan del cliente.

## Arquitectura del front

- `src/pages/` páginas (rutas), `src/components/<area>/` componentes, `src/hooks/` hooks,
  `src/context/` providers, `src/services/*.service.ts` llamadas a la API, `src/config/types.ts`
  tipos compartidos con la API.
- Imports con el alias `@/` (apunta a `src/`).
- **HTTP solo desde `src/services/`** usando `apiClient` de `@/config/api`. Los componentes no
  importan axios.
- El access token vive en memoria (`setAccessToken`); **nunca** en `localStorage` ni
  `sessionStorage`. El refresh viaja en cookie httpOnly.
- Componentes de función con hooks; respetá las reglas de hooks y las dependencias de `useEffect`.
  Limpiá suscripciones (sockets, timers) en el cleanup.
- Toda pantalla que carga datos muestra estado de carga y de error.
- Estilos con clases de Tailwind usando los tokens del tema (`gold`, `surface`, `text`, `danger`…).
  Textos de la UI en español.
- Sin `any`: si no sabés el tipo, usá `unknown` y estrechalo.

## Tests

| Tipo | Archivo | Dónde | Necesita base |
|---|---|---|---|
| Unitario / modelo | `*.spec.ts` | junto al código | No |
| Integración | `*.integration-spec.ts` | junto al código | Sí |
| End-to-end | `*.e2e-spec.ts` | `back/test/` | Sí |

- Toda regla de negocio nueva o modificada lleva test, empezando por el `*.model.spec.ts`.
- Todo bug arreglado lleva un test que fallaba antes del arreglo.
- Fechas fijas en los tests (por ejemplo años `2099-…`), nunca dependientes del día en que se corre.
- Preferí verificar comportamiento (lo que devuelve, lo que queda en la base) antes que "se llamó a
  tal mock".
- Usá builders con `overrides` (`buildPromotion({ enabled: false })`) en vez de repetir objetos
  enteros. `it.each` para tablas de casos.
- Las descripciones de los tests van en español y describen el comportamiento esperado.

## Estilo de código

- TypeScript en todo el proyecto. Formato: Prettier en el back (`singleQuote`, `trailingComma: all`);
  lint: ESLint (back) y oxlint (front). No discutas formato en los PR: lo resuelven las herramientas.
- Nombres: archivos y carpetas en `camelCase` (`roomService.service.ts`), clases en `PascalCase`,
  constantes en `UPPER_SNAKE_CASE`. Código (identificadores) en inglés; mensajes al usuario y
  comentarios en español.
- Comentarios solo para el **porqué** (una restricción, una decisión no obvia), no para repetir lo
  que dice el código. JSDoc corto (`/** … */`) en reglas de negocio y DTOs.
- Funciones chicas, early returns, sin código muerto ni `console.log` olvidados (usá el `Logger` de
  Nest en el back).
- **Colecciones de forma declarativa**: para filtrar, transformar o buscar en arrays usá `filter`,
  `map`, `find`, `some`, `every`, `flatMap`, en vez de un `for` con `if`/`continue` y `push` a un
  array auxiliar.

  ```ts
  // ❌ No
  const active = [];
  for (const promo of promotions) {
    if (!promo.enabled) continue;
    active.push(promo.title);
  }

  // ✅ Sí
  const active = promotions.filter((promo) => promo.enabled).map((promo) => promo.title);
  ```

  Un `for...of` está bien cuando de verdad hace falta: `await` en secuencia (uno detrás de otro a
  propósito), cortar con `break` algo que no se resuelve con `find`/`some`, o efectos secundarios
  que no producen un array nuevo. `reduce` solo si queda más claro que la alternativa.
- No agregues dependencias sin necesidad; si agregás una, explicá por qué en el PR.

## Seguridad

- Nunca commitees secretos: `.env` está ignorado; los valores de ejemplo van vacíos en `.env.example`.
- No logues contraseñas, tokens, datos de pago ni documentos de huéspedes.
- No expongas campos sensibles en DTOs de respuesta (hash de contraseña, refresh tokens, claves).
- Las evals y los seeds se corren contra la base local, nunca contra producción.

## Git y Pull Requests

- Ramas desde `dev`: `feat/<tema>`, `fix/<tema>`, `refactor/<tema>`, `docs/<tema>`, `chore/<tema>`.
  Los PR van a `dev`; `dev` se mergea a `main`.
- Commits en inglés con [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(chat): reply in English to English-speaking guests`. Tipos: `feat`, `fix`, `refactor`,
  `test`, `docs`, `chore`, `ci`. El scope es el módulo o área (`chat`, `payment`, `front`, `evals`…).
- PRs chicos y enfocados en una sola cosa. La descripción explica **qué** cambia, **por qué**, cómo
  se probó y, si aplica, la user story (`US-XX`) y capturas de la UI.
- Cada PR lo revisa CodeRabbit (configurado en `.coderabbit.yaml`) además de un integrante del
  equipo. Respondé o resolvé sus comentarios antes de mergear; si no estás de acuerdo, explicá por
  qué en el hilo.
- No mezcles en un PR cambios de formato masivos o de `package-lock.json` que no correspondan al tema.

## Para agentes de IA

- Leé el código vecino antes de escribir: copiá sus patrones en lugar de inventar nuevos.
- Hacé el cambio mínimo que resuelve el pedido; no refactorices de paso lo que no te pidieron.
- Corré lint, build y tests de la parte que tocaste antes de decir que terminaste, y reportá lo que
  no pudiste verificar.
- No toques migraciones ya mergeadas, `.env`, ni archivos generados (`dist/`, `*.tsbuildinfo`,
  `.snapshot.json` salvo vía `migration:create`).
- No hagas commits, push ni PRs salvo que te lo pidan.
