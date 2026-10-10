import { useCallback, useRef, useState } from 'react';

interface DocumentUploaderProps {
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
}

const ACCEPTED = '.pdf,.txt';
const ACCEPTED_MIME = ['application/pdf', 'text/plain'];

const isAccepted = (file: File) => {
  const name = file.name.toLowerCase();
  return ACCEPTED_MIME.includes(file.type) || name.endsWith('.pdf') || name.endsWith('.txt');
};

export default function DocumentUploader({ onUpload, disabled }: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setLocalError(null);
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        if (!isAccepted(file)) {
          setLocalError(`«${file.name}» no es un formato soportado. Solo PDF o TXT.`);
          continue;
        }
        try {
          await onUpload(file);
        } catch {
        }
      }
    },
    [onUpload],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition motion-reduce:transition-none ${
          disabled
            ? 'cursor-not-allowed border-goldLight/10 opacity-60'
            : isDragging
              ? 'border-gold bg-gold/5'
              : 'border-goldLight/25 hover:border-goldLight/50 hover:bg-surface/40'
        }`}
        aria-disabled={disabled}
      >
        <p className="text-sm font-medium text-text">
          Arrastrá tus archivos acá o <span className="text-goldLight underline">elegí un archivo</span>
        </p>
        <p className="text-xs text-textMuted">Solo PDF y TXT · máx. 20 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          hidden
          disabled={disabled}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {localError && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-dangerText">
          {localError}
        </p>
      )}
    </div>
  );
}