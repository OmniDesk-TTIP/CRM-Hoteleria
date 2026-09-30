import type { RoomOption } from '@/config/types';

interface ConfirmDisableRoomModalProps {
  room: RoomOption;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmDisableRoomModal({ room, onClose, onConfirm }: ConfirmDisableRoomModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-danger/20 bg-card p-6 shadow-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <span className="text-xl text-dangerText">⚠</span>
        </div>
        <h2 className="mb-2 text-lg font-bold text-text">¿Deshabilitar Habitación?</h2>
        <p className="mb-6 text-sm text-textMuted">
          La habitación <strong>{room.roomNumber}</strong> ({room.categoryName}) deja de estar disponible: Chamber
          no va a volver a ofrecerla en el bot. No se borra ningún dato ni se pierden las reservas ya asociadas.
          <br />
          <br />
          Podés reactivarla en cualquier momento desde esta misma pantalla.
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
            Sí, deshabilitar
          </button>
        </div>
      </div>
    </div>
  );
}
