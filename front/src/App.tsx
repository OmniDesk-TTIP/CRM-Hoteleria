import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import AuthProvider from '@/context/AuthProvider';
import SocketProvider from '@/context/SocketProvider';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import LoginPage from '@/pages/auth/LoginPage';
import PaymentPage from '@/pages/payments/PaymentPage';
import PaymentSuccessPage from '@/pages/payments/PaymentSuccessPage';
import ReservationsPage from '@/pages/admin/ReservationsPage';
import ChatsPage from '@/pages/admin/ChatsPage';
import SupportHoursPage from '@/pages/admin/SupportHoursPage';
import RoomsPage from '@/pages/admin/RoomsPage';
import HomePage from '@/pages/admin/HomePage';
import AppLayout from '@/components/layout/AppLayout';

function App() {
  return (
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
                <Route path="/admin/reservations" element={<ReservationsPage />} />
                <Route path="/admin/rooms" element={<RoomsPage />} />

                {/* US-11: la conversación abierta va en la URL, igual que el id de la reserva */}
                <Route path="/admin/chats" element={<ChatsPage />} />
                <Route path="/admin/chats/:chatId" element={<ChatsPage />} />

                {/* configurar el horario de la recepción sí es cosa de ADMIN, como en el back */}
                <Route element={<ProtectedRoute roles={['ADMIN']} />}>
                  <Route path="/admin/support-hours" element={<SupportHoursPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
