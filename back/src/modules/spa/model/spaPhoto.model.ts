export const MAX_SPA_PHOTOS = 20;

export const PUBLIC_SPA_PHOTO_PATH = '/public/spa/photos';

export interface SpaPhotoProps {
  id: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
}

export class SpaPhotoModel {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  position: number;

  constructor(props: SpaPhotoProps) {
    this.id = props.id;
    this.mimeType = props.mimeType;
    this.sizeBytes = props.sizeBytes;
    this.position = props.position;
  }

  publicPath(): string {
    return `${PUBLIC_SPA_PHOTO_PATH}/${this.id}`;
  }
}
