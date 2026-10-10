import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import AuthProvider from '@/context/AuthProvider';
import ThemeProvider from '@/context/ThemeProvider';
import SocketProvider from '@/context/SocketProvider';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import LoginPage from '@/pages/auth/LoginPage';
import PaymentPage from '@/pages/payments/PaymentPage';
import PaymentSuccessPage from '@/pages/payments/PaymentSuccessPage';
import ReservationsPage from '@/pages/admin/ReservationsPage';
import ChatsPage from '@/pages/admin/ChatsPage';
import SupportHoursPage from '@/pages/admin/SupportHoursPage';
import RoomsPage from '@/pages/admin/RoomsPage';
import SpaPage from '@/pages/admin/SpaPage';
import SpaReservationsPage from '@/pages/admin/SpaReservationsPage';
import HomePage from '@/pages/admin/HomePage';
import AppLayout from '@/components/layout/AppLayout';
import TabbedLayout, { type TabItem } from '@/components/layout/TabbedLayout';
import StatisticsPage from '@/pages/admin/StatisticsPage';

const RESERVATION_TABS: TabItem[] = [
  { to: '/admin/reservations', label: 'Habitaciones', end: true },
  { to: '/admin/reservations/spa', label: 'Spa', badge: 'pendingSpaReservations' },
];

const SERVICE_TABS: TabItem[] = [
  { to: '/admin/services', label: 'Habitaciones', end: true },
  { to: '/admin/services/spa', label: 'Spa' },
];

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          {/* Adentro de AuthProvider: el handshake del gateway necesita el access token. */}
          <SocketProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              {/* rutas del huésped: llega por un link de Telegram y no tiene cuenta */}
              <Route path="/payment/form/:reservationId" element={<PaymentPage />} />
              {/* sin id de reserva no hay nada que mostrar: la pantalla avisa que falta el link */}
              <Route path="/payment/form" element={<PaymentPage />} />

              {/* vuelta de Mercado Pago; el back redirige acá después de confirmar el pago */}
              <Route path="/payment/success/:reservationId" element={<PaymentSuccessPage />} />
              <Route path="/payment/success" element={<PaymentSuccessPage />} />

              {/* por ahora cualquier usuario logueado (ADMIN o EMPLOYEE) entra a todo el panel */}
              <Route element={<ProtectedRoute />}>
                {/* todas las pantallas del panel comparten la sidebar y la barra de estado */}
                <Route element={<AppLayout />}>
                  <Route path="/admin" element={<HomePage />} />
                  {/* Reservas y servicios: una ruta por pestaña (Habitaciones | Spa) */}
                  <Route
                    path="/admin/reservations"
                    element={<TabbedLayout tabs={RESERVATION_TABS} maxWidth="max-w-7xl" />}
                  >
                    <Route index element={<ReservationsPage />} />
                    <Route path="spa" element={<SpaReservationsPage />} />
                  </Route>
                  <Route
                    path="/admin/services"
                    element={<TabbedLayout tabs={SERVICE_TABS} maxWidth="max-w-6xl" />}
                  >
                    <Route index element={<RoomsPage />} />
                    <Route path="spa" element={<SpaPage />} />
                  </Route>

                  {/* rutas anteriores: se redirigen para no romper favoritos */}
                  <Route path="/admin/rooms" element={<Navigate to="/admin/services" replace />} />
                  <Route path="/admin/spa" element={<Navigate to="/admin/services/spa" replace />} />
                  <Route
                    path="/admin/spa-reservations"
                    element={<Navigate to="/admin/reservations/spa" replace />}
                  />

                  {/* US-11: la conversación abierta va en la URL, igual que el id de la reserva */}
                  <Route path="/admin/chats" element={<ChatsPage />} />
                  <Route path="/admin/chats/:chatId" element={<ChatsPage />} />

                  <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                    <Route path="/admin/support-hours" element={<SupportHoursPage />} />
                    <Route path="/admin/statistics" element={<StatisticsPage />} />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </SocketProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
