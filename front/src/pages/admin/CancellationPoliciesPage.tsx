import { useCallback, useEffect, useState } from 'react';
import type { CancellationPolicy } from '@/config/types';
import { activateCancellationPolicy, listCancellationPolicies } from '@/services/cancellation.service';
import CancellationPolicyFormModal from '@/components/admin/CancellationPolicyFormModal';
import { describeTiers } from '@/components/admin/refundFormat';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const actionButtonClasses =
  'rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

export default function CancellationPoliciesPage() {
  const [policies, setPolicies] = useState<CancellationPolicy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<CancellationPolicy | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setPolicies(await listCancellationPolicies());
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar las políticas de cancelación.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleCreate = () => {
    setEditingPolicy(null);
    setFormModalOpen(true);
  };

  const handleEdit = (policy: CancellationPolicy) => {
    setEditingPolicy(policy);
    setFormModalOpen(true);
  };

  const handleActivate = async (policy: CancellationPolicy) => {
    setActionError(null);
    setActivatingId(policy.id);
    try {
      await activateCancellationPolicy(policy.id);
      await fetchPolicies();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Error al activar la política.'));
    } finally {
      setActivatingId(null);
    }
  };

  const hasActive = policies.some((policy) => policy.active);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Políticas de cancelación</h1>
          <p className="text-sm text-textMuted">
            La política vigente define cuánto de la seña se devuelve al cancelar. Chamber se la informa al huésped.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="w-full rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight sm:w-auto motion-reduce:transition-none"
        >
          + Nueva política
        </button>
      </div>

      {!isLoading && !error && !hasActive && (
        <div role="status" className="rounded-lg border border-gold/30 bg-gold/10 p-3 text-sm text-goldLight">
          No hay una política vigente: las cancelaciones se registran sin devolución de la seña y Chamber no promete
          reintegros. {policies.length > 0 ? 'Activá una de las políticas de abajo.' : 'Creá una para empezar.'}
        </div>
      )}

      {actionError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {actionError}
        </div>
      )}

      {isLoading && <p className="px-1 py-6 text-center text-sm text-textMuted">Cargando políticas…</p>}
      {error && <p className="px-1 py-6 text-center text-sm text-dangerText">{error}</p>}
      {!isLoading && !error && policies.length === 0 && (
        <p className="rounded-2xl border border-goldLight/15 bg-card px-5 py-10 text-center text-sm text-textMuted">
          Todavía no hay políticas de cancelación.
        </p>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {policies.map((policy) => (
          <li
            key={policy.id}
            className={`flex flex-col gap-4 rounded-2xl border bg-card p-5 ${
              policy.active ? 'border-gold/50' : 'border-goldLight/15'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 break-words text-lg font-semibold text-text">{policy.name}</h2>
              {policy.active ? (
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-success/20 px-3 py-1 text-xs font-medium text-successText">
                  Vigente
                </span>
              ) : (
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-surface px-3 py-1 text-xs font-medium text-textMuted">
                  Inactiva
                </span>
              )}
            </div>

            <ul className="space-y-1.5 text-sm text-text">
              {describeTiers(policy).map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="text-gold">
                    •
                  </span>
                  {line}
                </li>
              ))}
            </ul>

            <div className="mt-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => handleEdit(policy)} className={actionButtonClasses}>
                Editar
              </button>
              {!policy.active && (
                <button
                  type="button"
                  onClick={() => handleActivate(policy)}
                  disabled={activatingId !== null}
                  className={actionButtonClasses}
                >
                  {activatingId === policy.id ? 'Activando…' : 'Dejar vigente'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-textMuted">
        Editar una política cambia el cálculo de las próximas cancelaciones; las reservas ya canceladas conservan la
        política y el monto que se les aplicó.
      </p>

      {formModalOpen && (
        <CancellationPolicyFormModal
          policy={editingPolicy}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setFormModalOpen(false);
            fetchPolicies();
          }}
        />
      )}
    </div>
  );
}