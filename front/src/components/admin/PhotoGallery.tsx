import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { API_BASE_URL } from '@/config/api';
import type { GalleryPhoto } from '@/config/types';
import ConfirmDeleteModal from './ConfirmDeleteModal';

export interface PhotoGalleryApi {
  list: () => Promise<GalleryPhoto[]>;
  upload: (file: File) => Promise<GalleryPhoto>;
  reorder: (ids: string[]) => Promise<GalleryPhoto[]>;
  remove: (id: string) => Promise<void>;
}

interface PhotoGalleryProps {
  isAdmin: boolean;
  title: string;
  description: string;
  /** Se pinta debajo del encabezado (por ejemplo, el selector de tipo de habitación). */
  toolbar?: ReactNode;
  /** Tiene que ser estable (módulo o useMemo): si cambia, la galería se vuelve a cargar. */
  api: PhotoGalleryApi;
  maxPhotos: number;
  emptyText: string;
  photoAlt: (index: number) => string;
  deleteWarning: string;
}

const MAX_PHOTO_MB = 5;
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const photoSrc = (photo: GalleryPhoto): string => `${API_BASE_URL}${photo.url}`;

const moveButtonClasses =
  'rounded-full border border-goldLight/25 bg-card/90 px-2.5 py-1 text-xs font-medium text-text transition hover:bg-goldLight/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

export default function PhotoGallery({
  isAdmin,
  title,
  description,
  toolbar,
  api,
  maxPhotos,
  emptyText,
  photoAlt,
  deleteWarning,
}: PhotoGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<GalleryPhoto | null>(null);

  const fetchPhotos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setPhotos(await api.list());
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar las fotos.'));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setIsBusy(true);

    try {
      for (const file of Array.from(files)) {
        if (!ACCEPTED_MIME.includes(file.type)) {
          setError(`«${file.name}» no es una imagen JPG, PNG o WebP.`);
          continue;
        }
        if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
          setError(`«${file.name}» supera los ${MAX_PHOTO_MB} MB.`);
          continue;
        }
        try {
          const uploaded = await api.upload(file);
          setPhotos((prev) => [...prev, uploaded]);
        } catch (err: unknown) {
          setError(errorMessage(err, `No se pudo subir «${file.name}».`));
        }
      }
    } finally {
      setIsBusy(false);
    }
  };

  const move = async (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= photos.length) return;

    const reordered = [...photos];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const previous = photos;
    setPhotos(reordered);
    setError(null);
    setIsBusy(true);

    try {
      setPhotos(await api.reorder(reordered.map((photo) => photo.id)));
    } catch (err: unknown) {
      setPhotos(previous);
      setError(errorMessage(err, 'No se pudo guardar el orden.'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    const photo = deleting;
    setDeleting(null);
    setError(null);
    setIsBusy(true);

    try {
      await api.remove(photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err: unknown) {
      setError(errorMessage(err, 'No se pudo eliminar la foto.'));
    } finally {
      setIsBusy(false);
    }
  };

  const isFull = photos.length >= maxPhotos;

  return (
    <section className="space-y-4 rounded-2xl border border-goldLight/15 bg-card p-4 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <p className="text-sm text-textMuted">{description}</p>
        </div>
        {isAdmin && (
          <>
            <button
              type="button"
              disabled={isBusy || isFull || isLoading}
              onClick={() => inputRef.current?.click()}
              className="w-full shrink-0 whitespace-nowrap rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:opacity-50 sm:w-auto motion-reduce:transition-none"
            >
              {isBusy ? 'Guardando…' : '+ Subir fotos'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_MIME.join(',')}
              multiple
              hidden
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>

      {toolbar}

      {isAdmin && (
        <p className="text-xs text-textMuted">
          JPG, PNG o WebP · máx. {MAX_PHOTO_MB} MB por foto · hasta {maxPhotos} fotos ({photos.length}/{maxPhotos}).
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-sm text-textMuted">Cargando fotos…</p>
      ) : photos.length === 0 ? (
        <p className="py-8 text-center text-sm text-textMuted">{emptyText}</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-xl border border-goldLight/15 bg-surface">
              <div className="relative aspect-[4/3]">
                <img
                  src={photoSrc(photo)}
                  alt={photoAlt(index)}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {index === 0 && (
                  <span className="absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-shell">
                    Portada
                  </span>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center justify-between gap-1 p-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={isBusy || index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Mover la foto ${index + 1} antes`}
                      className={moveButtonClasses}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || index === photos.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Mover la foto ${index + 1} después`}
                      className={moveButtonClasses}
                    >
                      →
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setDeleting(photo)}
                    className="rounded-full border border-danger/40 px-2.5 py-1 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:opacity-40 motion-reduce:transition-none"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {deleting && (
        <ConfirmDeleteModal title="¿Eliminar foto?" onClose={() => setDeleting(null)} onConfirm={handleConfirmDelete}>
          {deleteWarning}
        </ConfirmDeleteModal>
      )}
    </section>
  );
}
