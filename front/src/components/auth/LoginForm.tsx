import { useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { isAxiosError } from 'axios';
import type { LoginFieldErrors, LoginFormProps } from '@/config/types';

type Status = 'idle' | 'submitting';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validate = (email: string, password: string): LoginFieldErrors => {
  const errors: LoginFieldErrors = {};
  const trimmed = email.trim();

  if (!trimmed) errors.email = 'Ingresá tu email.';
  else if (!EMAIL_RE.test(trimmed)) errors.email = 'Ese email no parece válido.';

  // A propósito sin largo mínimo, igual que el LoginDto del back: acá solo le daría
  // pistas a quien esté probando contraseñas.
  if (!password) errors.password = 'Ingresá tu contraseña.';

  return errors;
};

/**
 * El interceptor de axios ya deja el `message` de Nest en `error.message`, pero para el
 * 401 se reescribe igual y la rama sin respuesta se traduce: si no, un back caído
 * mostraría "Network Error" en inglés en medio de una pantalla en castellano.
 */
const loginErrorMessage = (error: unknown): string => {
  if (isAxiosError(error)) {
    if (error.response?.status === 401) return 'Email o contraseña incorrectos.';
    if (error.response?.status === 400) return error.message;
    if (!error.response) {
      return 'No pudimos conectarnos con el servidor. Probá de nuevo en unos minutos.';
    }
  }

  return error instanceof Error ? error.message : 'No pudimos iniciar sesión. Probá de nuevo.';
};

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [passwordVisible, setPasswordVisible] = useState(false);
  // Recién después del primer envío fallido se revalida mientras se escribe: así el
  // formulario no reta al usuario antes de que haya terminado de tipear.
  const [submitted, setSubmitted] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const isSubmitting = status === 'submitting';

  const revalidate = (nextEmail: string, nextPassword: string) => {
    if (submitted) setFieldErrors(validate(nextEmail, nextPassword));
    // Un 401 viejo colgado arriba mientras se corrigen las credenciales confunde.
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    setSubmitted(true);
    setFormError(null);

    const errors = validate(email, password);
    setFieldErrors(errors);

    if (errors.email || errors.password) {
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setStatus('submitting');
    try {
      await onLogin({ email, password });
      // Si salió bien la navegación desmonta este componente, así que no hace falta
      // volver a 'idle'.
    } catch (error) {
      console.error('No se pudo iniciar sesión', error);
      setFormError(loginErrorMessage(error));
      setStatus('idle');
      // El email casi siempre está bien; se limpia solo la contraseña.
      setPassword('');
      passwordRef.current?.focus();
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8">
      <TextField
        id="email"
        label="Email"
        type="email"
        value={email}
        onChange={(value) => {
          setEmail(value);
          revalidate(value, password);
        }}
        error={fieldErrors.email}
        autoComplete="email"
        disabled={isSubmitting}
        inputRef={emailRef}
        extraProps={{ inputMode: 'email', autoCapitalize: 'none', spellCheck: false }}
      />

      <div className="mt-5">
        <TextField
          id="password"
          label="Contraseña"
          type={passwordVisible ? 'text' : 'password'}
          value={password}
          onChange={(value) => {
            setPassword(value);
            revalidate(email, value);
          }}
          error={fieldErrors.password}
          autoComplete="current-password"
          disabled={isSubmitting}
          inputRef={passwordRef}
          inputClassName="pr-24"
        >
          {/* type="button" es obligatorio: si no, este botón envía el formulario. */}
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-textMuted transition hover:text-goldLight motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {passwordVisible ? 'Ocultar' : 'Mostrar'}
          </button>
        </TextField>
      </div>

      {/* El 401 del back es deliberadamente igual para email inexistente y contraseña
          equivocada, así que no se marca ningún campo: solo esta caja. */}
      {formError && (
        <p role="alert" className="mt-5 rounded-xl bg-danger/15 px-4 py-3 text-sm text-dangerText">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 w-full rounded-full bg-gold py-3 text-sm font-semibold text-shell transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-shell"
      >
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  inputClassName?: string;
  /** Contenido absoluto dentro del campo, como el botón de mostrar contraseña. */
  children?: ReactNode;
  extraProps?: Record<string, unknown>;
}

/**
 * Sin placeholder a propósito: con el label visible no aporta información, y a un
 * contraste que se lea bien sobre `surface` se confundiría con un valor ya escrito.
 */
function TextField({
  id,
  label,
  type,
  value,
  onChange,
  error,
  autoComplete,
  disabled,
  inputRef,
  inputClassName = '',
  children,
  extraProps,
}: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-textMuted">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={id}
          ref={inputRef}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...extraProps}
          className={`w-full rounded-xl border border-goldLight/15 bg-surface px-4 py-3 text-sm text-text transition hover:border-goldLight/30 motion-reduce:transition-none focus-visible:border-gold/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-shell disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus-visible:ring-danger/50 ${inputClassName}`}
        />
        {children}
      </div>

      {/* Sin role="alert" por campo: se anunciaría junto con el error general. El foco
          se mueve al primer campo inválido, y de ahí el lector lee este texto. */}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-dangerText">
          {error}
        </p>
      )}
    </div>
  );
}
