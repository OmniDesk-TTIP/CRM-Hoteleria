import { useState } from 'react';
import type { SpaService, SpaServiceFormData, SpaServiceStatus } from '@/config/types';
import { createSpaService, updateSpaService } from '@/services/spa.service';
import { WEEKDAY_OPTIONS } from './spaFormat';

interface SpaServiceFormModalProps {
  service: SpaService | null;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-60';

const STATUS_OPTIONS: { value: SpaServiceStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Deshabilitado' },
];

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export default function SpaServiceFormModal({ service, onClose, onSuccess }: SpaServiceFormModalProps) {
  const isEdit = Boolean(service);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<SpaServiceFormData>({
    name: service?.name ?? '',
    description: service?.description ?? '',
    durationMinutes: service?.durationMinutes ?? 60,
    price: service?.price ?? 0,
    status: service?.status ?? 'ACTIVE',
    availableWeekdays: service?.availableWeekdays ?? [1, 2, 3, 4, 5],
    opensAt: service?.opensAt ?? '10:00',
    closesAt: service?.closesAt ?? '20:00',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'number' ? Number(value) : value }));
  };

  const toggleWeekday = (weekday: number) => {
    setFormData((prev) => ({
      ...prev,
      availableWeekdays: prev.availableWeekdays.includes(weekday)
        ? prev.availableWeekdays.filter((day) => day !== weekday)
        : [...prev.availableWeekdays, weekday],
    }));
  };

  const validate = (): string | null => {
    if (formData.durationMinutes <= 0) return 'La duración debe ser mayor a 0 minutos.';
    if (formData.price <= 0) return 'El precio debe ser mayor a $0.';
    if (formData.availableWeekdays.length === 0) return 'Elegí al menos un día de la semana.';
    if (toMinutes(formData.closesAt) <= toMinutes(formData.opensAt)) {
      return 'La hora de cierre tiene que ser posterior a la de apertura.';
    }
    if (formData.durationMinutes > toMinutes(formData.closesAt) - toMinutes(formData.opensAt)) {
      return 'La duración del servicio no entra en la franja horaria.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && service) {
        await updateSpaService(service.id, formData);
      } else {
        await createSpaService(formData);
      }
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar el servicio. Verificá los datos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-4 shadow-xl sm:p-6">
        <h2 className="mb-4 text-xl font-bold text-text">{isEdit ? 'Editar servicio de spa' : 'Nuevo servicio de spa'}</h2>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Nombre *
            <input
              required
              maxLength={120}
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={inputClasses}
              placeholder="Ej: Masaje descontracturante"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Descripción *
            <textarea
              required
              rows={3}
              maxLength={1000}
              name="description"
              value={formData.description}
              onChange={handleChange}
              className={inputClasses}
              placeholder="Qué incluye, para quién es, recomendaciones…"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Duración (minutos) *
              <input
                required
                type="number"
                min="1"
                max="720"
                step="1"
                name="durationMinutes"
                value={formData.durationMinutes}
                onChange={handleChange}
                className={inputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Precio *
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                name="price"
                value={formData.price}
                onChange={handleChange}
                className={inputClasses}
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm text-textMuted">Días disponibles *</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map((day) => {
                const selected = formData.availableWeekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleWeekday(day.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition motion-reduce:transition-none ${
                      selected
                        ? 'border-gold bg-gold/15 text-goldLight'
                        : 'border-goldLight/20 text-textMuted hover:bg-goldLight/10'
                    }`}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Desde *
              <input
                required
                type="time"
                name="opensAt"
                value={formData.opensAt}
                onChange={handleChange}
                className={inputClasses}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Hasta *
              <input
                required
                type="time"
                name="closesAt"
                value={formData.closesAt}
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
              className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
