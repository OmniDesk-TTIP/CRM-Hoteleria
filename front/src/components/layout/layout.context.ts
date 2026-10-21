import { useOutletContext } from 'react-router-dom';

/** Lo que AppLayout comparte con las pantallas del panel (por el contexto del Outlet). */
export interface LayoutContext {
  /** Turnos de spa esperando que recepción los confirme o rechace. */
  pendingSpaReservations: number;
  /** Vuelve a pedir el contador; se llama después de resolver un turno. */
  refreshPendingSpaReservations: () => void;
  /** Pedidos de mesa del restó esperando que recepción los confirme o rechace. */
  pendingRestaurantReservations: number;
  refreshPendingRestaurantReservations: () => void;
}

export const useLayoutContext = () => useOutletContext<LayoutContext>();
