export const MAX_PHOTOS = 20;

export const PUBLIC_PHOTO_PATH = '/public/restaurant/photos';

export interface RestaurantPhotoProps {
  id: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
}

export class RestaurantPhotoModel {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  position: number;

  constructor(props: RestaurantPhotoProps) {
    this.id = props.id;
    this.mimeType = props.mimeType;
    this.sizeBytes = props.sizeBytes;
    this.position = props.position;
  }

  publicPath(): string {
    return `${PUBLIC_PHOTO_PATH}/${this.id}`;
  }
}
