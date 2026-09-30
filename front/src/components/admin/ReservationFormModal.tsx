import { useState, useEffect } from 'react';
import type { AdminReservation, ReservationFormData, RoomOption } from '@/config/types';
import { createReservation, updateReservation } from '@/services/reservation.service';
import { listRoomOptions } from '@/services/room.service';

interface ReservationFormModalProps {
  reservation: AdminReservation | null; // Si es null, opera en modo Create
  onClose: () => void;
  onSuccess: () => void;
}

const inputClasses = 'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

const DEPOSIT_PERCENTAGE = 0.3;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const calculateNights = (checkIn: string, checkOut: string): number => {
  if (!checkIn || !checkOut) return 1;
  const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / MS_PER_DAY);
  return Number.isFinite(nights) && nights > 0 ? nights : 1;
};

export default function ReservationFormModal({ reservation, onClose, onSuccess }: ReservationFormModalProps) {
  const isEdit = Boolean(reservation);
  
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<ReservationFormData>({
    guestFullName: reservation?.guestFullName || '',
    guestDni: reservation?.guestDni || '',
    roomId: reservation?.room.id || '',
    checkIn: reservation?.checkIn ? reservation.checkIn.slice(0, 10) : '',
    checkOut: reservation?.checkOut ? reservation.checkOut.slice(0, 10) : '',
    status: reservation?.status || 'CONFIRMED',
    totalAmount: reservation?.totalAmount || 0,
    depositAmount: reservation?.depositAmount || 0,
  });

  useEffect(() => {
    listRoomOptions()
      .then(setRooms)
      .catch(() => setError('Error al cargar las habitaciones.'))
      .finally(() => setIsLoadingRooms(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: type === 'number' ? Number(value) : value };

      if (name === 'roomId' || name === 'checkIn' || name === 'checkOut') {
        const room = rooms.find((r) => r.id === next.roomId);
        if (room) {
          const totalAmount = roundMoney(room.basePrice * calculateNights(next.checkIn, next.checkOut));
          next.totalAmount = totalAmount;
          next.depositAmount = roundMoney(totalAmount * DEPOSIT_PERCENTAGE);
        }
      }

      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.totalAmount <= 0 || formData.depositAmount <= 0) {
      setError('El monto total y la seña deben ser mayores a $0.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && reservation) {
        await updateReservation(reservation.id, formData);
      } else {
        await createReservation(formData);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al guardar la reserva. Verifica la disponibilidad.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-bold text-text">
          {isEdit ? 'Editar Reserva' : 'Nueva Reserva Manual'}
        </h2>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Nombre Completo *
              <input required name="guestFullName" value={formData.guestFullName} onChange={handleChange} className={inputClasses} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              DNI *
              <input required name="guestDni" value={formData.guestDni} onChange={handleChange} className={inputClasses} />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Habitación *
            <select required name="roomId" value={formData.roomId} onChange={handleChange} disabled={isLoadingRooms} className={inputClasses}>
              <option value="" disabled>Selecciona una habitación</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.categoryName} - Hab. {room.roomNumber} (Cap: {room.capacity})
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Check-in *
              <input required type="date" name="checkIn" value={formData.checkIn} onChange={handleChange} className={inputClasses} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Check-out *
              <input required type="date" name="checkOut" value={formData.checkOut} onChange={handleChange} className={inputClasses} />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Estado inicial *
            <select required name="status" value={formData.status} onChange={handleChange} className={inputClasses}>
              <option value="PENDING_PAYMENT">Pendiente</option>
              <option value="CONFIRMED">Confirmada</option>
              <option value="CANCELLED">Cancelada</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Monto Total *
              <input required type="number" min="0" step="0.01" name="totalAmount" value={formData.totalAmount} onChange={handleChange} className={inputClasses} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Seña *
              <input required type="number" min="0" step="0.01" name="depositAmount" value={formData.depositAmount} onChange={handleChange} className={inputClasses} />
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-goldLight/10 pt-4">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text">
              Cancelar
            </button>
            <button type="submit" disabled={isSubmitting} className="rounded-xl bg-gold px-4 py-2 font-medium text-background transition hover:bg-goldLight disabled:opacity-50">
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}