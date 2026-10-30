import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth.context';
import { deleteMenuItem, getRestaurantSettings, listMenuItems, updateMenuItem } from '@/services/restaurant.service';
import type { MenuItem, RestaurantSettings } from '@/config/types';
import RestaurantSettingsCard from '@/components/admin/RestaurantSettingsCard';
import MenuItemsTable from '@/components/admin/MenuItemsTable';
import MenuItemFormModal from '@/components/admin/MenuItemFormModal';
import RestaurantGallery from '@/components/admin/RestaurantGallery';
import ConfirmDeleteModal from '@/components/admin/ConfirmDeleteModal';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export default function RestaurantPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [items, setItems] = useState<MenuItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<MenuItem | null>(null);

  const fetchSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      setSettings(await getRestaurantSettings());
    } catch (err: unknown) {
      setSettingsError(errorMessage(err, 'Error al cargar la información del restaurante.'));
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setIsLoadingItems(true);
    setItemsError(null);
    try {
      setItems(await listMenuItems());
    } catch (err: unknown) {
      setItemsError(errorMessage(err, 'Error al cargar la carta.'));
    } finally {
      setIsLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchItems();
  }, [fetchSettings, fetchItems]);

  const categories = Array.from(new Set(items.map((item) => item.category)));

  const handleCreate = () => {
    setEditingItem(null);
    setFormModalOpen(true);
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormModalOpen(true);
  };

  const handleToggleStatus = async (item: MenuItem) => {
    setActionError(null);
    try {
      await updateMenuItem(item.id, { status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      fetchItems();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Error al actualizar el plato.'));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    setActionError(null);
    try {
      await deleteMenuItem(deletingItem.id);
      setDeletingItem(null);
      fetchItems();
    } catch (err: unknown) {
      setDeletingItem(null);
      setActionError(errorMessage(err, 'Error al eliminar el plato.'));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Restaurante</h1>
        <p className="text-sm text-textMuted">
          Chamber lo ofrece solo a huéspedes con reserva confirmada o alojados. La carta y las fotos se publican en la
          web del hotel.
        </p>
      </div>

      {settingsError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {settingsError}
        </div>
      )}
      {settings ? (
        <RestaurantSettingsCard settings={settings} isAdmin={isAdmin} onSaved={setSettings} />
      ) : (
        !settingsError && <p className="text-sm text-textMuted">Cargando información…</p>
      )}

      <section className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold text-text">Carta</h2>
            <p className="text-sm text-textMuted">Los platos deshabilitados no se ofrecen ni se publican.</p>
          </div>
          {isAdmin && (
            <button
              onClick={handleCreate}
              className="w-full rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight sm:w-auto motion-reduce:transition-none"
            >
              + Nuevo plato
            </button>
          )}
        </div>

        {actionError && (
          <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
            {actionError}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
          <MenuItemsTable
            items={items}
            isLoading={isLoadingItems}
            error={itemsError}
            isAdmin={isAdmin}
            onEdit={handleEdit}
            onToggleStatus={handleToggleStatus}
            onDelete={setDeletingItem}
          />
        </div>
      </section>

      <RestaurantGallery isAdmin={isAdmin} />

      {formModalOpen && (
        <MenuItemFormModal
          item={editingItem}
          categories={categories}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setFormModalOpen(false);
            fetchItems();
          }}
        />
      )}

      {deletingItem && (
        <ConfirmDeleteModal
          title="¿Eliminar plato?"
          onClose={() => setDeletingItem(null)}
          onConfirm={handleConfirmDelete}
        >
          <strong>{deletingItem.name}</strong> se borra de la carta. Si solo querés dejar de ofrecerlo por un tiempo,
          deshabilitalo.
        </ConfirmDeleteModal>
      )}
    </div>
  );
}
