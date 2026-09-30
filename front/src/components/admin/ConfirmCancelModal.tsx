import type { AdminReservation } from '@/config/types';

interface ConfirmCancelModalProps {
  reservation: AdminReservation;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmCancelModal({ reservation, onClose, onConfirm }: ConfirmCancelModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-danger/20 bg-card p-6 shadow-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <span className="text-xl text-dangerText">⚠</span>
        </div>
        <h2 className="mb-2 text-lg font-bold text-text">¿Cancelar Reserva?</h2>
        <p className="mb-6 text-sm text-textMuted">
          Estás por cancelar la reserva de <strong>{reservation.guestFullName}</strong> (Check-in: {new Date(`${reservation.checkIn}T00:00:00`).toLocaleDateString('es-AR')}). 
          La habitación {reservation.room.roomNumber} quedará liberada inmediatamente.
          <br /><br />
          Esta acción no se puede deshacer.
        </p>

        <div className="flex justify-center gap-3">
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
            Sí, cancelar reserva
          </button>
        </div>
      </div>
    </div>
  );
}