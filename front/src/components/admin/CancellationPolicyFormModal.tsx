import { useState } from 'react';
import type { CancellationPolicy, CancellationTier } from '@/config/types';
import { createCancellationPolicy, updateCancellationPolicy } from '@/services/cancellation.service';

interface CancellationPolicyFormModalProps {
  /** null = política nueva. */
  policy: CancellationPolicy | null;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-60';

const MAX_TIERS = 10;

const validateTiers = (tiers: CancellationTier[]): string | null => {
  if (tiers.length === 0) return 'Agregá al menos un tramo.';
  if (tiers.some((tier) => !Number.isInteger(tier.minDaysBeforeCheckIn) || tier.minDaysBeforeCheckIn < 0)) {
    return 'Los días de anticipación tienen que ser enteros de 0 o más.';
  }
  if (tiers.some((tier) => !(tier.refundPercentage >= 0 && tier.refundPercentage <= 100))) {
    return 'El porcentaje de devolución tiene que estar entre 0 y 100.';
  }

  const sorted = [...tiers].sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minDaysBeforeCheckIn === sorted[i - 1].minDaysBeforeCheckIn) {
      return 'No puede haber dos tramos con los mismos días de anticipación.';
    }
    if (sorted[i].refundPercentage > sorted[i - 1].refundPercentage) {
      return 'Cancelar con más anticipación no puede devolver un porcentaje menor.';
    }
  }
  return null;
};

export default function CancellationPolicyFormModal({ policy, onClose, onSuccess }: CancellationPolicyFormModalProps) {
  const isEdit = Boolean(policy);

  const [name, setName] = useState(policy?.name ?? '');
  const [tiers, setTiers] = useState<CancellationTier[]>(
    policy?.tiers ?? [
      { minDaysBeforeCheckIn: 7, refundPercentage: 100 },
      { minDaysBeforeCheckIn: 3, refundPercentage: 50 },
    ],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateTier = (index: number, patch: Partial<CancellationTier>) => {
    setTiers((prev) => prev.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateTiers(tiers);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = { name: name.trim(), tiers };
      if (policy) await updateCancellationPolicy(policy.id, payload);
      else await createCancellationPolicy(payload);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar la política. Verificá los datos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-4 shadow-xl sm:p-6">
        <h2 className="mb-4 text-xl font-bold text-text">
          {isEdit ? 'Editar política de cancelación' : 'Nueva política de cancelación'}
        </h2>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Nombre *
            <input
              required
              minLength={3}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses}
              placeholder="Ej: Flexible"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm text-textMuted">Tramos de devolución *</legend>
            <p className="text-xs text-textMuted">
              Con al menos esa cantidad de días antes del check-in se devuelve ese porcentaje de la seña. Por debajo del
              último tramo no se devuelve nada.
            </p>

            <ul className="space-y-2">
              {tiers.map((tier, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-textMuted">
                    Días de anticipación
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      value={tier.minDaysBeforeCheckIn}
                      onChange={(e) => updateTier(index, { minDaysBeforeCheckIn: Number(e.target.value) })}
                      className={inputClasses}
                    />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-textMuted">
                    % de la seña
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={tier.refundPercentage}
                      onChange={(e) => updateTier(index, { refundPercentage: Number(e.target.value) })}
                      className={inputClasses}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setTiers((prev) => prev.filter((_, i) => i !== index))}
                    disabled={tiers.length === 1}
                    aria-label={`Quitar tramo ${index + 1}`}
                    className="rounded-full border border-danger/40 px-3 py-2 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setTiers((prev) => [...prev, { minDaysBeforeCheckIn: 0, refundPercentage: 0 }])}
              disabled={tiers.length >= MAX_TIERS}
              className="rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            >
              + Agregar tramo
            </button>
          </fieldset>

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