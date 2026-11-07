import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Promotion, PromotionListFilters } from '@/config/types';
import { deletePromotion, listPromotions, setPromotionEnabled } from '@/services/promotion.service';
import { PromotionStatusBadge } from '@/components/admin/Badges';
import ConfirmDeleteModal from '@/components/admin/ConfirmDeleteModal';
import Pagination from '@/components/admin/Pagination';
import PromotionFormModal from '@/components/admin/PromotionFormModal';
import {
  canAnnounce,
  describeValidity,
  STATUS_FILTERS,
  targetLabel,
} from '@/components/admin/promotionFormat';

const PAGE_SIZE = 10;

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const inputClasses =
  'rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

const actionButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none';

const deleteButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 motion-reduce:transition-none';

type PendingAction = { type: 'toggle' | 'delete'; promotion: Promotion };

/** US-21: promociones que Chamber ofrece y aplica al cotizar. Solo Administradores (CA7). */
export default function PromotionsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PromotionListFilters>({ status: 'ALL', page: 1, pageSize: PAGE_SIZE });
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const fetchPromotions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listPromotions(filters);
      setPromotions(result.data);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar las promociones.'));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchPromotions();
  }, [fetchPromotions]);

  const openForm = (promotion: Promotion | null) => {
    setEditingPromotion(promotion);
    setFormModalOpen(true);
  };

  const handleConfirm = async () => {
    if (!pendingAction) return;
    const { type, promotion } = pendingAction;
    setPendingAction(null);
    setActionError(null);
    try {
      if (type === 'delete') await deletePromotion(promotion.id);
      else await setPromotionEnabled(promotion.id, !promotion.enabled);

      // Si se fue el último elemento de la página, se vuelve a la anterior en vez de mostrarla vacía.
      if (type === 'delete' && promotions.length === 1 && filters.page > 1) {
        setFilters((prev) => ({ ...prev, page: prev.page - 1 }));
      } else {
        await fetchPromotions();
      }
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'No se pudo actualizar la promoción.'));
    }
  };

  const isEmpty = !isLoading && !error && promotions.length === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Promociones</h1>
          <p className="text-sm text-textMuted">
            Chamber informa las vigentes y las aplica al cotizar. No se acumulan: si corresponden varias, se aplica la de
            mayor descuento.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openForm(null)}
          className="w-full shrink-0 rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight sm:w-auto motion-reduce:transition-none"
        >
          + Nueva promoción
        </button>
      </div>

      <label className="flex w-full flex-col gap-1 text-sm text-textMuted sm:w-56">
        Estado
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters((prev) => ({
              ...prev,
              status: e.target.value as PromotionListFilters['status'],
              page: 1,
            }))
          }
          className={inputClasses}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {actionError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {actionError}
        </div>
      )}

      {isLoading && <p className="px-1 py-6 text-center text-sm text-textMuted">Cargando promociones…</p>}
      {error && <p className="px-1 py-6 text-center text-sm text-dangerText">{error}</p>}
      {isEmpty && (
        <p className="rounded-2xl border border-goldLight/15 bg-card px-5 py-10 text-center text-sm text-textMuted">
          {filters.status === 'ALL' ? 'Todavía no hay promociones.' : 'No hay promociones con ese estado.'}
        </p>
      )}

      {!isLoading && !error && promotions.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
          <ul className="divide-y divide-goldLight/10">
            {promotions.map((promotion) => (
              <li key={promotion.id} className="space-y-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-semibold text-text">{promotion.title}</h2>
                    <p className="text-sm text-textMuted">{promotion.description}</p>
                  </div>
                  <PromotionStatusBadge status={promotion.status} />
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:grid-cols-4">
                  <div>
                    <dt className="text-xs text-textMuted">Descuento</dt>
                    <dd className="font-medium text-gold">{promotion.discountPercentage}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Aplica a</dt>
                    <dd className="text-text">{targetLabel(promotion.target)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Vigencia</dt>
                    <dd className="text-text">{describeValidity(promotion)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Condiciones</dt>
                    <dd className="text-text">
                      {promotion.minNights ? `Mínimo ${promotion.minNights} noches` : 'Sin condiciones'}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => openForm(promotion)} className={actionButtonClasses}>
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction({ type: 'toggle', promotion })}
                    className={actionButtonClasses}
                  >
                    {promotion.enabled ? 'Deshabilitar' : 'Habilitar'}
                  </button>
                  {canAnnounce(promotion) && (
                    <button
                      type="button"
                      onClick={() => navigate('/admin/campaigns', { state: { promotion } })}
                      className={actionButtonClasses}
                    >
                      Enviar campaña
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingAction({ type: 'delete', promotion })}
                    className={deleteButtonClasses}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            page={filters.page}
            pageSize={filters.pageSize}
            total={total}
            onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
          />
        </div>
      )}

      {formModalOpen && (
        <PromotionFormModal
          promotion={editingPromotion}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setFormModalOpen(false);
            fetchPromotions();
          }}
        />
      )}

      {pendingAction?.type === 'delete' && (
        <ConfirmDeleteModal
          title="¿Eliminar promoción?"
          onClose={() => setPendingAction(null)}
          onConfirm={handleConfirm}
        >
          <strong>{pendingAction.promotion.title}</strong> deja de ofrecerse y no se puede recuperar. Las reservas que ya
          la usaron conservan el descuento que se les aplicó.
        </ConfirmDeleteModal>
      )}

      {pendingAction?.type === 'toggle' && (
        <ConfirmDeleteModal
          title={pendingAction.promotion.enabled ? '¿Deshabilitar promoción?' : '¿Habilitar promoción?'}
          confirmLabel={pendingAction.promotion.enabled ? 'Sí, deshabilitar' : 'Sí, habilitar'}
          onClose={() => setPendingAction(null)}
          onConfirm={handleConfirm}
        >
          <strong>{pendingAction.promotion.title}</strong>{' '}
          {pendingAction.promotion.enabled
            ? 'deja de ofrecerse: Chamber no la va a mencionar ni aplicar desde la próxima consulta.'
            : 'vuelve a ofrecerse mientras esté dentro de su vigencia.'}
        </ConfirmDeleteModal>
      )}
    </div>
  );
}
