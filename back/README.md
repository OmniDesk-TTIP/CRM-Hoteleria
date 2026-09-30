# Comandos Principales del Proyecto

Este documento contiene la guía de los comandos más utilizados para el desarrollo, gestión de contenedores, base de datos y ejecución de pruebas del proyecto.

## 🚀 Inicio de la Aplicación

- **`npm start dev`**
  Inicia la aplicación en modo desarrollo. (El servidor se reiniciará automáticamente si hay cambios en el código).

## 🐳 Docker (Contenedores)

- **`docker-compose up -d`**
  Levanta los servicios y contenedores definidos en el archivo `docker-compose.yml` en segundo plano (*detached mode*). Normalmente se usa para levantar la base de datos y otras dependencias locales.

- **`docker-compose down -v`**
  Detiene y elimina los contenedores, redes y **volúmenes** (`-v`). *Atención: esto borrará todos los datos almacenados en los volúmenes de la base de datos local.*

## 🗄️ Base de Datos (MikroORM)

- **`npx mikro-orm migration:create`**
  Analiza las entidades de tu código y genera un nuevo archivo de migración con los cambios detectados para la base de datos.

- **`npx mikro-orm migration:up`**
  Ejecuta todas las migraciones pendientes para actualizar el esquema de la base de datos al estado más reciente.

## 🌐 Webhook de Mercado Pago (ngrok)

- **`ngrok http 3000`**
  Levanta un túnel público hacia el backend local (puerto 3000), necesario para que Mercado Pago pueda entregar las notificaciones del webhook (`/payment/webhook`) durante el desarrollo local.

  Pasos para probar pagos localmente:
  1. Iniciá la aplicación (`npm start dev`).
  2. Corré `ngrok http 3000` y copiá la URL pública `https://...ngrok-free.dev` que te muestra.
  3. Pegá esa URL en la variable `APP_BASE_URL` del archivo `.env`.
  4. Configurá `https://<tu-url-de-ngrok>/payment/webhook` como notification URL en el panel de Mercado Pago (sección **Webhooks** de tu aplicación).
  5. Reiniciá la aplicación para que tome el nuevo `APP_BASE_URL`.

## 🔐 Autenticación (JWT)

Los endpoints del backend están protegidos por defecto: hay un guard global y lo que es público
se marca explícitamente con `@Public()`. Las cuentas son de **empleados del hotel**; los huéspedes
siguen usando el bot de Telegram sin cuenta.

### Endpoints

| Verbo | Ruta | Acceso |
|---|---|---|
| `POST` | `/auth/login` | público |
| `POST` | `/auth/refresh` | público (la credencial es la cookie) |
| `POST` | `/auth/logout` | público |
| `POST` | `/auth/register` | solo rol `ADMIN` |
| `GET` | `/auth/me` | autenticado |

El **access token** se devuelve en el JSON y viaja en `Authorization: Bearer <token>`.
El **refresh token** viaja en una cookie `httpOnly` acotada a `/auth` y **rota en cada uso**: si se
reutiliza uno ya rotado se asume robo y se cierran todas las sesiones de ese usuario.

### El primer administrador

El registro está cerrado a rol `ADMIN`, así que el primer usuario lo crea la aplicación sola:
si al arrancar no hay ningún usuario y están `ADMIN_BOOTSTRAP_EMAIL` y `ADMIN_BOOTSTRAP_PASSWORD`,
se crea ese administrador y se avisa por log. Con la base ya poblada no hace nada.

### Variables de entorno

Están todas listadas en `.env.example`. Las de auth:

| Variable | Para qué |
|---|---|
| `JWT_SECRET` | Firma de los access tokens. Mínimo 32 caracteres o la app no arranca. |
| `JWT_EXPIRES_IN` | Vida del access token (`15m` por defecto). |
| `REFRESH_TOKEN_TTL_DAYS` | Vida del refresh token en días. |
| `BCRYPT_SALT_ROUNDS` | Costo del hash de contraseñas. |
| `AUTH_COOKIE_SECURE` / `AUTH_COOKIE_SAMESITE` | En producción, con front y back en dominios distintos: `true` y `none` (requiere HTTPS). |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | Administrador inicial. |

Generar el secreto:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 🧪 Pruebas (Testing)

- **`npm run test`**
  Ejecuta la suite de pruebas unitarias del proyecto.

- **`npm run test:e2e`**
  Ejecuta las pruebas *End-to-End* (E2E) para simular el comportamiento real de la aplicación de principio a fin.