import apiClient from '@/config/api';
import type { AuthUser, LoginCredentials, LoginResponse, RefreshResponse } from '@/config/types';

export const login = async (credentials: LoginCredentials): Promise<LoginResponse> => {
  // Campo por campo y nunca `...credentials`: el ValidationPipe del back usa
  // forbidNonWhitelisted, así que cualquier propiedad de más termina en un 400.
  const { data } = await apiClient.post<LoginResponse>('/auth/login', {
    email: credentials.email.trim().toLowerCase(),
    password: credentials.password,
  });

  return data;
};

/**
 * Promesa compartida del refresh en vuelo.
 *
 * El back rota el refresh token y tiene detección de reuso: si le llegan dos pedidos
 * con la misma cookie, el segundo la encuentra revocada y cierra TODAS las sesiones
 * del usuario. StrictMode monta los efectos dos veces en desarrollo, así que sin este
 * single-flight cada F5 podría desloguear al usuario de todos lados.
 *
 * Va a nivel de módulo y no en un useRef porque el remontaje de StrictMode reinicia
 * el estado del componente, pero no el del módulo.
 */
let inFlightRefresh: Promise<RefreshResponse> | null = null;

export const refreshSession = (): Promise<RefreshResponse> => {
  inFlightRefresh ??= apiClient
    .post<RefreshResponse>('/auth/refresh')
    .then(({ data }) => data)
    .finally(() => {
      inFlightRefresh = null;
    });

  return inFlightRefresh;
};

export const getCurrentUser = async (): Promise<AuthUser> => {
  const { data } = await apiClient.get<AuthUser>('/auth/me');
  return data;
};

/** El back revoca la sesión de esa cookie y la limpia; las otras del usuario siguen vivas. */
export const logout = async (): Promise<void> => {
  await apiClient.post('/auth/logout');
};
