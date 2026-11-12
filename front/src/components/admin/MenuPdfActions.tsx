import { useState } from 'react';
import { fetchMenuPdf, type MenuPdfKind } from '@/services/menuPdf.service';

interface Props {
  kind: MenuPdfKind;
  label: string;
  filename: string;
}

type Action = 'preview' | 'download';

const REVOKE_AFTER_MS = 60_000;

const BUTTON_CLASS =
  'rounded-xl border border-goldLight/30 px-3 py-2 text-sm font-medium text-goldLight transition hover:bg-goldLight/10 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

const download = (url: string, filename: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
};

export default function MenuPdfActions({ kind, label, filename }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action) => {
    const tab = action === 'preview' ? window.open('', '_blank') : null;
    setPending(action);
    setError(null);

    try {
      const url = URL.createObjectURL(await fetchMenuPdf(kind));
      if (tab) tab.location.href = url;
      else download(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    } catch (err: unknown) {
      tab?.close();
      setError(err instanceof Error ? err.message : 'No se pudo generar el PDF.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-textMuted">PDF de {label}:</span>
        <button type="button" onClick={() => run('preview')} disabled={pending !== null} className={BUTTON_CLASS}>
          {pending === 'preview' ? 'Generando…' : 'Ver'}
        </button>
        <button type="button" onClick={() => run('download')} disabled={pending !== null} className={BUTTON_CLASS}>
          {pending === 'download' ? 'Generando…' : 'Descargar'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-dangerText">
          {error}
        </p>
      )}
    </div>
  );
}
