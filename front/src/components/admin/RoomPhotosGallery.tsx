import { useMemo, useState } from 'react';
import type { RoomOption } from '@/config/types';
import { deleteRoomPhoto, listRoomPhotos, reorderRoomPhotos, uploadRoomPhoto } from '@/services/room.service';
import PhotoGallery, { type PhotoGalleryApi } from './PhotoGallery';

interface RoomPhotosGalleryProps {
  rooms: RoomOption[];
  isAdmin: boolean;
}

const MAX_PHOTOS = 10;

const selectClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:border-gold focus:outline-none sm:w-72';

// Las fotos son del tipo de habitación (Doble, Suite…), no de cada habitación: es lo que muestra
// la landing. Los tipos salen del inventario que ya cargó la página.
export default function RoomPhotosGallery({ rooms, isAdmin }: RoomPhotosGalleryProps) {
  const categories = useMemo(() => {
    const byId = new Map<string, string>();
    for (const room of rooms) byId.set(room.categoryId, room.categoryName);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [rooms]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Si el tipo elegido desaparece (o todavía no se eligió), cae en el primero.
  const selected = categories.find((category) => category.id === selectedId) ?? categories[0];

  const categoryId = selected?.id;
  const api = useMemo<PhotoGalleryApi | null>(
    () =>
      categoryId
        ? {
            list: () => listRoomPhotos(categoryId),
            upload: (file) => uploadRoomPhoto(categoryId, file),
            reorder: (ids) => reorderRoomPhotos(categoryId, ids),
            remove: (id) => deleteRoomPhoto(categoryId, id),
          }
        : null,
    [categoryId],
  );

  if (!selected || !api) return null;

  return (
    <PhotoGallery
      // Remonta al cambiar de tipo: no arrastra fotos, errores ni subidas del tipo anterior.
      key={selected.id}
      isAdmin={isAdmin}
      title="Fotos por tipo de habitación"
      description="Se muestran en la web del hotel en este orden. Todas las habitaciones del mismo tipo comparten la galería."
      toolbar={
        <label className="flex flex-col gap-1 text-sm text-textMuted sm:flex-row sm:items-center sm:gap-3">
          Tipo de habitación
          <select value={selected.id} onChange={(e) => setSelectedId(e.target.value)} className={selectClasses}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      }
      api={api}
      maxPhotos={MAX_PHOTOS}
      emptyText={`Todavía no hay fotos de «${selected.name}».`}
      photoAlt={(index) => `Foto ${index + 1} de la habitación ${selected.name}`}
      deleteWarning={`La foto deja de verse en la web del hotel para «${selected.name}». No se puede deshacer.`}
    />
  );
}
