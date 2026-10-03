import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import logoOmnidesk from '@/assets/logo-omnidesk-480.webp';
import logoOmnideskLight from '@/assets/logo-omnidesk-light.png';
import BrandPanel from '@/components/auth/BrandPanel';
import LoginForm from '@/components/auth/LoginForm';
import ThemeToggle from '@/components/layout/ThemeToggle';
import { useAuth } from '@/context/auth.context';
import { useTheme } from '@/context/theme.context';
import type { LoginCredentials } from '@/config/types';

export default function LoginPage() {
  const { login, isAuthenticated, status } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-shell px-4">
        <p className="text-sm text-textMuted">Cargando tu sesión…</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/admin" replace />;
  }

  const handleLogin = async (credentials: LoginCredentials) => {
    await login(credentials);

    const from = (location.state as { from?: string } | null)?.from ?? '/admin';
    navigate(from, { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-shell">
      <BrandPanel />

      <main className="relative flex w-full flex-col justify-center px-6 py-12 sm:px-10 lg:w-1/2">
        <ThemeToggle className="absolute right-4 top-4 z-10 rounded-full p-2 text-textMuted transition hover:bg-surface hover:text-goldLight motion-reduce:transition-none" />

        <div
          className="pointer-events-none absolute right-0 top-1/4 h-72 w-72 rounded-full bg-gold/10 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto w-full max-w-sm">
          <img
            src={theme === 'light' ? logoOmnideskLight : logoOmnidesk}
            alt="OmniDesk"
            width={480}
            height={584}
            className="mb-10 h-14 w-auto lg:hidden"
          />

          <h1 className="font-poppins text-2xl font-bold text-goldLight">Iniciá sesión</h1>
          <p className="mt-2 text-sm leading-relaxed text-textMuted">
            Entrá con tu cuenta para administrar las reservas del hotel.
          </p>

          <LoginForm onLogin={handleLogin} />
        </div>
      </main>
    </div>
  );
}
