import { useEffect, useMemo, useState } from 'react';
import type { RoomFormData, RoomOption, RoomStatus } from '@/config/types';
import { createRoom, updateRoom } from '@/services/room.service';

interface RoomFormModalProps {
  room: RoomOption | null;
  existingRooms: RoomOption[];
  onClose: () => void;
  onSuccess: () => void;
}

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-60';

const STATUS_OPTIONS: { value: RoomStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Activa' },
  { value: 'MAINTENANCE', label: 'Mantenimiento' },
  { value: 'INACTIVE', label: 'Deshabilitada' },
];

export default function RoomFormModal({ room, existingRooms, onClose, onSuccess }: RoomFormModalProps) {
  const isEdit = Boolean(room);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<RoomFormData>({
    roomNumber: room?.roomNumber ?? '',
    categoryName: room?.categoryName ?? '',
    capacity: room?.capacity ?? 2,
    basePrice: room?.basePrice ?? 0,
    status: room?.status ?? 'ACTIVE',
  });

  const existingCategories = useMemo(() => {
    const byName = new Map<string, { name: string; capacity: number; basePrice: number }>();
    for (const r of existingRooms) {
      byName.set(r.categoryName.trim().toLowerCase(), {
        name: r.categoryName,
        capacity: r.capacity,
        basePrice: r.basePrice,
      });
    }
    return byName;
  }, [existingRooms]);

  const matchedCategory = existingCategories.get(formData.categoryName.trim().toLowerCase()) ?? null;

  const isEditingSameType = isEdit && matchedCategory !== null && matchedCategory.name.toLowerCase() === (room?.categoryName ?? '').trim().toLowerCase();
  const fieldsLocked = matchedCategory !== null && !isEditingSameType;

  useEffect(() => {
    if (fieldsLocked && matchedCategory) {
      setFormData((prev) => ({ ...prev, capacity: matchedCategory.capacity, basePrice: matchedCategory.basePrice }));
    }
  }, [fieldsLocked, matchedCategory]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'number' ? Number(value) : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.capacity <= 0) {
      setError('La capacidad debe ser mayor a 0.');
      return;
    }
    if (formData.basePrice <= 0) {
      setError('El precio base debe ser mayor a $0.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && room) {
        await updateRoom(room.id, formData);
      } else {
        await createRoom(formData);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al guardar la habitación. Verificá los datos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-bold text-text">{isEdit ? 'Editar Habitación' : 'Nueva Habitación'}</h2>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Número/nombre de habitación *
            <input
              required
              maxLength={20}
              name="roomNumber"
              value={formData.roomNumber}
              onChange={handleChange}
              className={inputClasses}
              placeholder="Ej: 204"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Tipo *
            <input
              required
              maxLength={60}
              list="room-category-options"
              name="categoryName"
              value={formData.categoryName}
              onChange={handleChange}
              className={inputClasses}
              placeholder="Ej: Doble, Suite…"
            />
            <datalist id="room-category-options">
              {Array.from(existingCategories.values()).map((category) => (
                <option key={category.name} value={category.name} />
              ))}
            </datalist>
          </label>

          {fieldsLocked && matchedCategory && (
            <p className="rounded-lg border border-goldLight/15 bg-surface/60 px-3 py-2 text-xs text-textMuted">
              «{matchedCategory.name}» ya existe como tipo: se va a usar su capacidad y precio actuales. Para
              cambiarlos, editá cualquier habitación que ya sea de ese tipo.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Capacidad máxima *
              <input
                required
                type="number"
                min="1"
                step="1"
                name="capacity"
                disabled={fieldsLocked}
                value={formData.capacity}
                onChange={handleChange}
                className={inputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Precio base *
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                name="basePrice"
                disabled={fieldsLocked}
                value={formData.basePrice}
                onChange={handleChange}
                className={inputClasses}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Estado *
            <select required name="status" value={formData.status} onChange={handleChange} className={inputClasses}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-6 flex justify-end gap-3 border-t border-goldLight/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-gold px-4 py-2 font-medium text-background transition hover:bg-goldLight disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
