import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth.context';
import { deactivateRoom, listRoomOptions, updateRoom } from '@/services/room.service';
import type { RoomOption } from '@/config/types';
import RoomsTable from '@/components/admin/RoomsTable';
import RoomFormModal from '@/components/admin/RoomFormModal';
import ConfirmDisableRoomModal from '@/components/admin/ConfirmDisableRoomModal';

export default function RoomsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomOption | null>(null);

  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disablingRoom, setDisablingRoom] = useState<RoomOption | null>(null);

  const fetchRooms = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listRoomOptions();
      setRooms(result);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al cargar el inventario.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const handleCreate = () => {
    setEditingRoom(null);
    setFormModalOpen(true);
  };

  const handleEdit = (room: RoomOption) => {
    setEditingRoom(room);
    setFormModalOpen(true);
  };

  const handleDisableClick = (room: RoomOption) => {
    setDisablingRoom(room);
    setDisableModalOpen(true);
  };

  const handleConfirmDisable = async () => {
    if (!disablingRoom) return;
    try {
      await deactivateRoom(disablingRoom.id);
      setDisableModalOpen(false);
      setDisablingRoom(null);
      fetchRooms();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Error al deshabilitar la habitación.');
    }
  };

  const handleReactivate = async (room: RoomOption) => {
    try {
      await updateRoom(room.id, { status: 'ACTIVE' });
      fetchRooms();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Error al reactivar la habitación.');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Inventario de Habitaciones</h1>
        </div>
        {isAdmin && (
          <button
            onClick={handleCreate}
            className="rounded-xl bg-gold px-4 py-2 font-medium text-background transition hover:bg-goldLight motion-reduce:transition-none"
          >
            + Nueva Habitación
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <RoomsTable
          rooms={rooms}
          isLoading={isLoading}
          error={error}
          isAdmin={isAdmin}
          onEdit={handleEdit}
          onDisable={handleDisableClick}
          onReactivate={handleReactivate}
        />
      </div>

      {formModalOpen && (
        <RoomFormModal
          room={editingRoom}
          existingRooms={rooms}
          onClose={() => setFormModalOpen(false)}
          onSuccess={() => {
            setFormModalOpen(false);
            fetchRooms();
          }}
        />
      )}

      {disableModalOpen && disablingRoom && (
        <ConfirmDisableRoomModal
          room={disablingRoom}
          onClose={() => setDisableModalOpen(false)}
          onConfirm={handleConfirmDisable}
        />
      )}
    </div>
  );
}
