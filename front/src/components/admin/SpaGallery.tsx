import { deleteSpaPhoto, listSpaPhotos, reorderSpaPhotos, uploadSpaPhoto } from '@/services/spa.service';
import PhotoGallery, { type PhotoGalleryApi } from './PhotoGallery';

interface SpaGalleryProps {
  isAdmin: boolean;
}

const MAX_PHOTOS = 20;

const spaPhotosApi: PhotoGalleryApi = {
  list: listSpaPhotos,
  upload: uploadSpaPhoto,
  reorder: reorderSpaPhotos,
  remove: deleteSpaPhoto,
};

export default function SpaGallery({ isAdmin }: SpaGalleryProps) {
  return (
    <PhotoGallery
      isAdmin={isAdmin}
      title="Fotos del spa"
      description="Se muestran en la web del hotel en este orden. Subí fotos del espacio: sala, sauna, cabinas."
      api={spaPhotosApi}
      maxPhotos={MAX_PHOTOS}
      emptyText="Todavía no hay fotos del spa."
      photoAlt={(index) => `Foto ${index + 1} del spa`}
      deleteWarning="La foto deja de verse en la web del hotel. No se puede deshacer."
    />
  );
}
