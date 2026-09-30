import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
  // Sin esto el navegador descarta la cookie del refresh sin avisar: el login parece
  // andar y recién falla al recargar la página. La cookie tiene Path=/auth, así que
  // no viaja a /payment ni a /rag aunque esto sea global.
  withCredentials: true,
});

/**
 * El access token vive acá, en memoria del módulo, y nunca en localStorage: si se
 * filtra por XSS no queda nada persistido. El AuthProvider es el único que lo escribe.
 *
 * Que sea una variable de módulo y no el Context es lo que evita el ciclo de imports:
 * este archivo no sabe nada de React, y el contexto sí depende de este archivo.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

/** Lectura del token para el handshake del WebSocket (`/ws/chats`), que no pasa por axios. */
export const getAccessToken = (): string | null => accessToken;

export interface SessionHandlers {
  /** Renueva la sesión y devuelve el access token nuevo. Rechaza si ya no hay sesión. */
  refresh: () => Promise<string>;
  /** Se llama cuando el refresh falló: ya no hay nada que reintentar. */
  onSessionExpired: () => void;
}

/**
 * El interceptor necesita renovar la sesión, pero no puede importar `auth.service`:
 * ese módulo ya importa este y el ciclo dejaría `apiClient` undefined en tiempo de
 * carga. Además hacer el POST a /auth/refresh acá esquivaría el single-flight del
 * servicio, y dos refresh simultáneos disparan la detección de reuso del back, que
 * cierra TODAS las sesiones del usuario. Por eso el AuthProvider registra los handlers.
 */
let sessionHandlers: SessionHandlers | null = null;

export const setSessionHandlers = (handlers: SessionHandlers | null): void => {
  sessionHandlers = handlers;
};

/** El request original, marcado para que un 401 se reintente una sola vez. */
type RetriableConfig = InternalAxiosRequestConfig & { retriedAfterRefresh?: boolean };

/**
 * Endpoints de sesión: acá un 401 es la respuesta, no un token vencido. Reintentarlos
 * sería un bucle (refresh → 401 → refresh) y taparía el "credenciales incorrectas"
 * que el formulario de login necesita mostrar.
 */
const NO_RETRY_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

const canRetry = (config: RetriableConfig | undefined): config is RetriableConfig =>
  config !== undefined &&
  !config.retriedAfterRefresh &&
  !NO_RETRY_PATHS.some((path) => (config.url ?? '').includes(path));

apiClient.interceptors.request.use(
  (config) => {
    // `headers` es un AxiosHeaders: se usa .set() para no pisar los defaults de la instancia.
    if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);

    return config;
  },
  (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string | string[] }>) => {
    const config = error.config as RetriableConfig | undefined;
    // En una const: entre el await y el catch el provider podría haberlos desregistrado.
    const handlers = sessionHandlers;

    /**
     * El access token dura 15 minutos y sólo vive en memoria, así que sin esto una
     * pestaña abierta un rato empieza a fallar sola. Se renueva con la cookie del
     * refresh y se reintenta el request una vez; el token nuevo se lo pone el
     * interceptor de request, que vuelve a correr en el reintento.
     */
    if (error.response?.status === 401 && handlers && canRetry(config)) {
      config.retriedAfterRefresh = true;

      try {
        await handlers.refresh();

        return await apiClient.request(config);
      } catch {
        // La cookie venció o el back revocó la sesión: se avisa y sigue el rechazo
        // con el error original, que es el que la pantalla sabe mostrar.
        handlers.onSessionExpired();
      }
    }

    const data = error.response?.data;
    const detail = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;

    // Nest devuelve el detalle en `message`; lo dejamos en error.message para no
    // tener que desarmar la respuesta en cada pantalla.
    if (detail) error.message = detail;

    return Promise.reject(error);
  },
);

export default apiClient;
