import { useEffect, useState } from 'react';
import type { RestaurantSettings, RestaurantSettingsFormData, RestaurantShift } from '@/config/types';
import { updateRestaurantSettings } from '@/services/restaurant.service';
import { WEEKDAY_OPTIONS } from './spaFormat';

interface RestaurantSettingsCardProps {
  settings: RestaurantSettings;
  isAdmin: boolean;
  onSaved: (settings: RestaurantSettings) => void;
}

const MAX_SHIFTS = 3;

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-60';

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const toFormData = (settings: RestaurantSettings): RestaurantSettingsFormData => ({
  status: settings.status,
  description: settings.description ?? '',
  availableWeekdays: settings.availableWeekdays,
  shifts: settings.shifts,
  maxPartySize: settings.maxPartySize,
});

/** Información general del restó (CA1): estado, descripción, días, franjas y tamaño de mesa. */
export default function RestaurantSettingsCard({ settings, isAdmin, onSaved }: RestaurantSettingsCardProps) {
  const [formData, setFormData] = useState<RestaurantSettingsFormData>(() => toFormData(settings));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    setFormData(toFormData(settings));
  }, [settings]);

  const disabled = !isAdmin || isSubmitting;

  const toggleWeekday = (weekday: number) => {
    setFormData((prev) => ({
      ...prev,
      availableWeekdays: prev.availableWeekdays.includes(weekday)
        ? prev.availableWeekdays.filter((day) => day !== weekday)
        : [...prev.availableWeekdays, weekday],
    }));
  };

  const updateShift = (index: number, field: keyof RestaurantShift, value: string) => {
    setFormData((prev) => ({
      ...prev,
      shifts: prev.shifts.map((shift, i) => (i === index ? { ...shift, [field]: value } : shift)),
    }));
  };

  const addShift = () => {
    setFormData((prev) => ({ ...prev, shifts: [...prev.shifts, { opensAt: '20:00', closesAt: '23:00' }] }));
  };

  const removeShift = (index: number) => {
    setFormData((prev) => ({ ...prev, shifts: prev.shifts.filter((_, i) => i !== index) }));
  };

  const validate = (): string | null => {
    if (formData.availableWeekdays.length === 0) return 'Elegí al menos un día de la semana.';
    if (formData.shifts.length === 0) return 'Agregá al menos una franja horaria.';
    if (formData.shifts.some((shift) => toMinutes(shift.closesAt) <= toMinutes(shift.opensAt))) {
      return 'En cada franja la hora de cierre tiene que ser posterior a la de apertura.';
    }
    const sorted = [...formData.shifts].sort((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt));
    if (sorted.some((shift, i) => i > 0 && toMinutes(shift.opensAt) < toMinutes(sorted[i - 1].closesAt))) {
      return 'Las franjas horarias no pueden superponerse.';
    }
    if (formData.maxPartySize < 1) return 'La mesa tiene que ser de al menos 1 persona.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const saved = await updateRestaurantSettings(formData);
      setSavedAt(new Date());
      onSaved(saved);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar la información del restaurante.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-goldLight/15 bg-card p-4 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-text">Información y horarios</h2>
          <p className="text-sm text-textMuted">
            {settings.configured
              ? 'Lo que Chamber informa a los huéspedes y lo que se publica en la web del hotel.'
              : 'Todavía no se configuró: hasta que lo guardes, Chamber no ofrece el restaurante.'}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Estado *
          <select
            name="status"
            value={formData.status}
            disabled={disabled}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, status: e.target.value as RestaurantSettingsFormData['status'] }))
            }
            className={inputClasses}
          >
            <option value="ACTIVE">Abierto: Chamber lo ofrece y se publica en la web</option>
            <option value="INACTIVE">Deshabilitado: no se ofrece ni se publica</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Máximo de personas por mesa *
          <input
            required
            type="number"
            min="1"
            max="50"
            step="1"
            name="maxPartySize"
            value={formData.maxPartySize}
            disabled={disabled}
            onChange={(e) => setFormData((prev) => ({ ...prev, maxPartySize: Number(e.target.value) }))}
            className={inputClasses}
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-textMuted">
        Los grupos más grandes no se piden por el chat: Chamber los deriva a recepción.
      </p>

      <label className="flex flex-col gap-1 text-sm text-textMuted">
        Descripción
        <textarea
          rows={3}
          maxLength={1000}
          name="description"
          value={formData.description}
          disabled={disabled}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          className={inputClasses}
          placeholder="Tipo de cocina, ambiente, si se pide reserva…"
        />
      </label>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-sm text-textMuted">Días de atención *</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_OPTIONS.map((day) => {
            const selected = formData.availableWeekdays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleWeekday(day.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${
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

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-sm text-textMuted">Franjas horarias *</legend>
        <ul className="space-y-2">
          {formData.shifts.map((shift, index) => (
            <li key={index} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-textMuted">
                Desde
                <input
                  required
                  type="time"
                  value={shift.opensAt}
                  onChange={(e) => updateShift(index, 'opensAt', e.target.value)}
                  className={inputClasses}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-textMuted">
                Hasta
                <input
                  required
                  type="time"
                  value={shift.closesAt}
                  onChange={(e) => updateShift(index, 'closesAt', e.target.value)}
                  className={inputClasses}
                />
              </label>
              {isAdmin && formData.shifts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeShift(index)}
                  aria-label={`Quitar la franja de ${shift.opensAt} a ${shift.closesAt}`}
                  className="rounded-xl border border-danger/40 px-3 py-2 text-sm text-dangerText transition hover:bg-danger/10 disabled:opacity-60 motion-reduce:transition-none"
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && formData.shifts.length < MAX_SHIFTS && (
          <button
            type="button"
            onClick={addShift}
            className="rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none"
          >
            + Agregar franja
          </button>
        )}
      </fieldset>

      {isAdmin && (
        <div className="flex items-center justify-end gap-3 border-t border-goldLight/10 pt-4">
          {savedAt && (
            <p role="status" className="text-sm text-successText">
              Guardado.
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:opacity-50"
          >
            {isSubmitting ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}
    </form>
  );
}
