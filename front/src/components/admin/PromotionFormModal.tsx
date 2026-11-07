import { useState } from 'react';
import type { Promotion, PromotionFormData, PromotionTarget } from '@/config/types';
import { createPromotion, updatePromotion } from '@/services/promotion.service';
import { TARGET_OPTIONS } from './promotionFormat';

interface PromotionFormModalProps {
  /** null = promoción nueva. */
  promotion: Promotion | null;
  onClose: () => void;
  onSuccess: () => void;
}

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_DISCOUNT_PERCENTAGE = 99;

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

export default function PromotionFormModal({ promotion, onClose, onSuccess }: PromotionFormModalProps) {
  const [title, setTitle] = useState(promotion?.title ?? '');
  const [description, setDescription] = useState(promotion?.description ?? '');
  const [discountPercentage, setDiscountPercentage] = useState(String(promotion?.discountPercentage ?? ''));
  const [startDate, setStartDate] = useState(promotion?.startDate ?? '');
  const [endDate, setEndDate] = useState(promotion?.endDate ?? '');
  const [target, setTarget] = useState<PromotionTarget>(promotion?.target ?? 'ROOMS');
  const [minNights, setMinNights] = useState(String(promotion?.minNights ?? ''));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (endDate < startDate) {
      setError('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }

    const payload: PromotionFormData = {
      title: title.trim(),
      description: description.trim(),
      discountPercentage: Number(discountPercentage),
      startDate,
      endDate,
      target,
      minNights: target === 'ROOMS' && minNights ? Number(minNights) : null,
    };

    setIsSubmitting(true);
    try {
      if (promotion) await updatePromotion(promotion.id, payload);
      else await createPromotion(payload);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar la promoción. Verificá los datos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-form-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-4 shadow-xl sm:p-6"
      >
        <h2 id="promotion-form-title" className="mb-4 text-xl font-bold text-text">
          {promotion ? 'Editar promoción' : 'Nueva promoción'}
        </h2>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Título *
            <input
              required
              maxLength={MAX_TITLE_LENGTH}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClasses}
              placeholder="Ej: Escapada de verano"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Descripción *
            <textarea
              required
              rows={3}
              maxLength={MAX_DESCRIPTION_LENGTH}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputClasses} resize-y`}
              placeholder="Lo que Chamber le cuenta al huésped cuando pregunta por promociones"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Descuento (%) *
              <input
                required
                type="number"
                min="1"
                max={MAX_DISCOUNT_PERCENTAGE}
                step="1"
                value={discountPercentage}
                onChange={(e) => setDiscountPercentage(e.target.value)}
                className={inputClasses}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Aplica a *
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as PromotionTarget)}
                className={inputClasses}
              >
                {TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-textMuted">{TARGET_OPTIONS.find((option) => option.value === target)?.description}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Inicio de la vigencia *
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClasses}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Fin de la vigencia *
              <input
                required
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClasses}
              />
            </label>
          </div>

          {target === 'ROOMS' && (
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Mínimo de noches (opcional)
              <input
                type="number"
                min="1"
                step="1"
                value={minNights}
                onChange={(e) => setMinNights(e.target.value)}
                className={inputClasses}
                placeholder="Sin mínimo"
              />
            </label>
          )}

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
