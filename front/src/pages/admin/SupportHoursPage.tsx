import { useEffect, useState } from 'react';
import { getSupportHours, updateSupportHours } from '@/services/supportHours.service';
import type { SupportHoursDay } from '@/config/types';

/** 0 = domingo … 6 = sábado, igual que `Date.getDay()` y que el back. */
const WEEKDAY_LABEL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const inputClasses =
  'rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

export default function SupportHoursPage() {
  const [days, setDays] = useState<SupportHoursDay[]>([]);
  const [timeZone, setTimeZone] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const hours = await getSupportHours();
        if (cancelled) return;

        setDays(hours.days);
        setTimeZone(hours.timeZone);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los horarios.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const patchDay = (weekday: number, patch: Partial<SupportHoursDay>) => {
    setSavedAt(null);
    setDays((prev) => prev.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const hours = await updateSupportHours(days);

      setDays(hours.days);
      setTimeZone(hours.timeZone);
      setSavedAt(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los horarios.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Horarios de atención</h1>
        <p className="mt-1 text-sm text-textMuted">
          Fuera de este horario, a quien pida hablar con una persona el bot le avisa que le responden
          al abrir la recepción.
          {timeZone && ` Zona horaria: ${timeZone}.`}
        </p>
      </div>

      {isLoading && <p className="text-sm text-textMuted">Cargando horarios…</p>}
      {error && <p className="text-sm text-dangerText">⚠ {error}</p>}

      {!isLoading && days.length > 0 && (
        <>
          <div className="divide-y divide-goldLight/10 overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
            {days.map((day) => (
              <div key={day.weekday} className="flex flex-wrap items-center gap-4 p-4">
                <span className="w-28 text-sm font-medium text-text">{WEEKDAY_LABEL[day.weekday]}</span>

                <label className="flex items-center gap-2 text-sm text-textMuted">
                  <input
                    type="checkbox"
                    checked={!day.isClosed}
                    onChange={(event) => patchDay(day.weekday, { isClosed: !event.target.checked })}
                    className="accent-gold"
                  />
                  Abierto
                </label>

                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={day.opensAt}
                    disabled={day.isClosed}
                    onChange={(event) => patchDay(day.weekday, { opensAt: event.target.value })}
                    className={inputClasses}
                    aria-label={`Hora de apertura del ${WEEKDAY_LABEL[day.weekday]}`}
                  />
                  <span className="text-textMuted">→</span>
                  <input
                    type="time"
                    value={day.closesAt}
                    disabled={day.isClosed}
                    onChange={(event) => patchDay(day.weekday, { closesAt: event.target.value })}
                    className={inputClasses}
                    aria-label={`Hora de cierre del ${WEEKDAY_LABEL[day.weekday]}`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3">
            {savedAt && <p className="text-sm text-successText">Guardado a las {savedAt}.</p>}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            >
              {isSaving ? 'Guardando…' : 'Guardar horarios'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
