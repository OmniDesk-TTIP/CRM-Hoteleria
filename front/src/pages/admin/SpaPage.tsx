import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth.context';
import { deactivateSpaService, listSpaServices, updateSpaService } from '@/services/spa.service';
import type { SpaService } from '@/config/types';
import SpaServicesTable from '@/components/admin/SpaServicesTable';
import SpaServiceFormModal from '@/components/admin/SpaServiceFormModal';
import ConfirmDisableSpaServiceModal from '@/components/admin/ConfirmDisableSpaServiceModal';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export default function SpaPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [services, setServices] = useState<SpaService[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<SpaService | null>(null);

  const [disablingService, setDisablingService] = useState<SpaService | null>(null);

  const fetchServices = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setServices(await listSpaServices());
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar los servicios de spa.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleCreate = () => {
    setEditingService(null);
    setFormModalOpen(true);
  };

  const handleEdit = (service: SpaService) => {
    setEditingService(service);
    setFormModalOpen(true);
  };

  const handleConfirmDisable = async () => {
    if (!disablingService) return;
    setActionError(null);
    try {
      await deactivateSpaService(disablingService.id);
      setDisablingService(null);
      fetchServices();
    } catch (err: unknown) {
      setDisablingService(null);
      setActionError(errorMessage(err, 'Error al deshabilitar el servicio.'));
    }
  };

  const handleReactivate = async (service: SpaService) => {
    setActionError(null);
    try {
      await updateSpaService(service.id, { status: 'ACTIVE' });
      fetchServices();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Error al reactivar el servicio.'));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Servicios de Spa</h1>
          <p className="text-sm text-textMuted">
            Chamber los ofrece a huéspedes con reserva confirmada.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleCreate}
            className="w-full rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight sm:w-auto motion-reduce:transition-none"
          >
            + Nuevo servicio
          </button>
        )}
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {actionError}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <SpaServicesTable
          services={services}
          isLoading={isLoading}
          error={error}
          isAdmin={isAdmin}
          onEdit={handleEdit}
          onDisable={setDisablingService}
          onReactivate={handleReactivate}
        />
      </div>

      {formModalOpen && (
        <SpaServiceFormModal
          service={editingService}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setFormModalOpen(false);
            fetchServices();
          }}
        />
      )}

      {disablingService && (
        <ConfirmDisableSpaServiceModal
          service={disablingService}
          onClose={() => setDisablingService(null)}
          onConfirm={handleConfirmDisable}
        />
      )}
    </div>
  );
}
