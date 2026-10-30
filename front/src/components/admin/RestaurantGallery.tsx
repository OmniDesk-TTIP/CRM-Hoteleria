import {
  deleteRestaurantPhoto,
  listRestaurantPhotos,
  reorderRestaurantPhotos,
  uploadRestaurantPhoto,
} from '@/services/restaurant.service';
import PhotoGallery, { type PhotoGalleryApi } from './PhotoGallery';

interface RestaurantGalleryProps {
  isAdmin: boolean;
}

const MAX_PHOTOS = 20;

const restaurantPhotosApi: PhotoGalleryApi = {
  list: listRestaurantPhotos,
  upload: uploadRestaurantPhoto,
  reorder: reorderRestaurantPhotos,
  remove: deleteRestaurantPhoto,
};

export default function RestaurantGallery({ isAdmin }: RestaurantGalleryProps) {
  return (
    <PhotoGallery
      isAdmin={isAdmin}
      title="Fotos del restaurante"
      description="Se muestran en la web del hotel en este orden y Chamber comparte el link cuando un huésped quiere ver el lugar."
      api={restaurantPhotosApi}
      maxPhotos={MAX_PHOTOS}
      emptyText="Todavía no hay fotos del restaurante."
      photoAlt={(index) => `Foto ${index + 1} del restaurante`}
      deleteWarning="La foto deja de verse en la web del hotel. No se puede deshacer."
    />
  );
}
