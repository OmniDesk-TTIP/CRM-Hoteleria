import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSurveySummary, listSurveyResponses, setSurveyPublication } from '@/services/survey.service';
import PeriodFilter from '@/components/reviews/PeriodFilter';
import ReviewsSummary from '@/components/reviews/ReviewsSummary';
import ReviewList from '@/components/reviews/ReviewList';
import Pagination from '@/components/admin/Pagination';
import { describePeriod, presetPeriod, todayKey, type ReviewPeriodPreset } from '@/components/reviews/periods';
import { RefreshIcon } from '@/components/layout/icons';
import type { SurveyPeriod, SurveyResponse, SurveySummary } from '@/config/types';

const PAGE_SIZE = 10;

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** US-18: resultados de la encuesta post-estadía. La ruta ya está limitada a ADMIN en App.tsx (CA6). */
export default function ReviewsPage() {
  const today = todayKey();
  const [preset, setPreset] = useState<ReviewPeriodPreset>('month');
  const [custom, setCustom] = useState<SurveyPeriod>({});
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<SurveySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [reviews, setReviews] = useState<SurveyResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const period = useMemo<SurveyPeriod>(
    () => (preset === 'custom' ? custom : presetPeriod(preset, today)),
    [preset, custom, today],
  );
  const { from, to } = period;

  // El back también lo rechaza, pero así no se dispara un pedido que ya sabemos que falla.
  const periodError = from && to && from > to ? 'La fecha "desde" no puede ser posterior a "hasta".' : null;

  // Si el período cambia con un pedido en vuelo, la respuesta vieja pisaría a la nueva: solo vale la del último.
  const lastSummaryRequest = useRef(0);
  const lastListRequest = useRef(0);

  const fetchSummary = useCallback(async () => {
    if (periodError) return;
    const requestId = ++lastSummaryRequest.current;
    setSummaryError(null);

    try {
      const data = await getSurveySummary({ from, to });
      if (requestId === lastSummaryRequest.current) setSummary(data);
    } catch (err: unknown) {
      if (requestId === lastSummaryRequest.current) {
        setSummary(null);
        setSummaryError(errorMessage(err, 'No se pudo cargar el resumen de las encuestas.'));
      }
    }
  }, [from, to, periodError]);

  const fetchReviews = useCallback(async () => {
    if (periodError) return;
    const requestId = ++lastListRequest.current;
    setIsLoading(true);
    setListError(null);

    try {
      const result = await listSurveyResponses({ from, to }, page, PAGE_SIZE);
      if (requestId !== lastListRequest.current) return;
      setReviews(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      if (requestId !== lastListRequest.current) return;
      setReviews([]);
      setTotal(0);
      setListError(errorMessage(err, 'No se pudieron cargar las respuestas.'));
    } finally {
      if (requestId === lastListRequest.current) setIsLoading(false);
    }
  }, [from, to, page, periodError]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  // Con otro período seleccionado, los números de antes serían engañosos: no se muestran.
  const currentSummary = summary && summary.from === (from ?? null) && summary.to === (to ?? null) ? summary : null;

  const handlePresetChange = (next: ReviewPeriodPreset) => {
    // El rango personalizado arranca con el período que se estaba viendo, para ajustarlo desde ahí.
    if (next === 'custom' && preset !== 'custom') setCustom(period);
    setPreset(next);
    setPage(1);
  };

  const handleCustomChange = (next: SurveyPeriod) => {
    setCustom(next);
    setPage(1);
  };

  const handleRefresh = () => {
    void fetchSummary();
    void fetchReviews();
  };

  const handleTogglePublication = async (review: SurveyResponse) => {
    setActionError(null);
    setBusyId(review.id);
    try {
      const updated = await setSurveyPublication(review.id, !review.published);
      setReviews((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'No se pudo actualizar la publicación de la reseña.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 border-b border-gold/30 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gold md:text-4xl">Reseñas</h1>
          <p className="mt-1 text-sm text-textMuted">
            Encuesta de satisfacción post-estadía · {describePeriod(period)}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <PeriodFilter
            preset={preset}
            onPresetChange={handlePresetChange}
            custom={custom}
            onCustomChange={handleCustomChange}
            today={today}
          />

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || Boolean(periodError)}
            className="flex items-center justify-center gap-2 rounded-full bg-gold px-5 py-2 text-sm font-medium text-shell transition hover:bg-goldLight disabled:opacity-60 motion-reduce:transition-none"
          >
            <RefreshIcon className={`h-4 w-4 ${isLoading ? 'motion-safe:animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </header>

      {periodError && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-dangerText">
          {periodError}
        </p>
      )}

      {!periodError && (
        <>
          {summaryError && (
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-dangerText">
              {summaryError}
            </p>
          )}
          {!currentSummary && !summaryError && (
            <p className="py-8 text-center text-sm text-textMuted">Cargando el resumen…</p>
          )}
          {currentSummary && <ReviewsSummary summary={currentSummary} />}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text">Respuestas</h2>

            {actionError && (
              <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
                {actionError}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
              <ReviewList
                reviews={reviews}
                isLoading={isLoading}
                error={listError}
                busyId={busyId}
                onTogglePublication={(review) => void handleTogglePublication(review)}
              />
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
