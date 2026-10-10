import type { SpaService } from '@/config/types';

interface ConfirmDisableSpaServiceModalProps {
  service: SpaService;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmDisableSpaServiceModal({
  service,
  onClose,
  onConfirm,
}: ConfirmDisableSpaServiceModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-danger/20 bg-card p-5 text-center shadow-xl sm:p-6">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <span className="text-xl text-dangerText">⚠</span>
        </div>
        <h2 className="mb-2 text-lg font-bold text-text">¿Deshabilitar servicio?</h2>
        <p className="mb-6 text-sm text-textMuted">
          <strong>{service.name}</strong> deja de ofrecerse: Chamber no lo va a mencionar en su próxima consulta. No se
          borra ningún dato ni las solicitudes ya registradas.
          <br />
          <br />
          Podés reactivarlo en cualquier momento desde esta misma pantalla.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-danger/90 px-4 py-2 font-medium text-white transition hover:bg-danger"
          >
            Sí, deshabilitar
          </button>
        </div>
      </div>
    </div>
  );
}
