import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth.context';
import type { UserRole } from '@/config/types';

interface ProtectedRouteProps {
  roles?: UserRole[];
}

export default function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { user, status, isAuthenticated } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-shell px-4">
        <p className="text-sm text-textMuted">Cargando tu sesión…</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  // Se muestra un mensaje en vez de redirigir: cualquier destino fijo acá puede terminar
  // rebotando al login, que a su vez devuelve al panel, y se arma un bucle infinito.
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-shell px-4">
        <p className="text-sm text-textMuted">No tenés permisos para ver esta sección.</p>
      </div>
    );
  }

  return <Outlet />;
}
