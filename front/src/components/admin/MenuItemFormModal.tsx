import { useState } from 'react';
import type { MenuItem, MenuItemFormData, MenuItemStatus } from '@/config/types';
import { createMenuItem, updateMenuItem } from '@/services/restaurant.service';

interface MenuItemFormModalProps {
  item: MenuItem | null;
  /** Secciones que ya existen en la carta, para sugerirlas y no escribirlas distinto cada vez. */
  categories: string[];
  onClose: () => void;
  onSuccess: () => void;
}

const SUGGESTED_CATEGORIES = ['Entradas', 'Principales', 'Postres', 'Bebidas'];

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-60';

const STATUS_OPTIONS: { value: MenuItemStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Deshabilitado' },
];

export default function MenuItemFormModal({ item, categories, onClose, onSuccess }: MenuItemFormModalProps) {
  const isEdit = Boolean(item);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<MenuItemFormData>({
    name: item?.name ?? '',
    description: item?.description ?? '',
    category: item?.category ?? '',
    price: item?.price ?? 0,
    status: item?.status ?? 'ACTIVE',
  });

  const suggestions = Array.from(new Set([...categories, ...SUGGESTED_CATEGORIES]));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'number' ? Number(value) : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.price <= 0) {
      setError('El precio debe ser mayor a $0.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && item) {
        await updateMenuItem(item.id, formData);
      } else {
        await createMenuItem(formData);
      }
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar el plato. Verificá los datos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-goldLight/20 bg-card p-4 shadow-xl sm:p-6">
        <h2 className="mb-4 text-xl font-bold text-text">{isEdit ? 'Editar plato' : 'Nuevo plato'}</h2>

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
              placeholder="Ej: Ojo de bife con papas"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-textMuted">
            Descripción
            <textarea
              rows={2}
              maxLength={500}
              name="description"
              value={formData.description}
              onChange={handleChange}
              className={inputClasses}
              placeholder="Ingredientes, guarnición, si es apto celíacos…"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Sección *
              <input
                required
                maxLength={60}
                name="category"
                list="menu-categories"
                value={formData.category}
                onChange={handleChange}
                className={inputClasses}
                placeholder="Ej: Principales"
              />
              <datalist id="menu-categories">
                {suggestions.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
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
          <p className="-mt-2 text-xs text-textMuted">
            Un plato deshabilitado deja de ofrecerse por el chat y de verse en la web, sin borrarse.
          </p>

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
