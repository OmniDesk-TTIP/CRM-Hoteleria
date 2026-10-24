import type { Campaign, CampaignStatus } from '@/config/types';
import Pagination from '@/components/admin/Pagination';
import { audienceLabel, formatCampaignDate, STATUS_LABELS } from './campaignFormat';

const STATUS_CLASSES: Record<CampaignStatus, string> = {
  SENDING: 'bg-gold/15 text-goldLight',
  COMPLETED: 'bg-success/20 text-successText',
  INTERRUPTED: 'bg-danger/15 text-dangerText',
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Enviados / fallidos sobre el total, con barra mientras se envía (CA5). */
function Results({ campaign }: { campaign: Campaign }) {
  const processed = campaign.sentCount + campaign.failedCount;
  const percent = campaign.totalRecipients > 0 ? Math.round((processed / campaign.totalRecipients) * 100) : 0;

  return (
    <div className="space-y-1">
      <p className="text-text">
        <span className="text-successText">{campaign.sentCount} enviados</span>
        {' · '}
        <span className={campaign.failedCount > 0 ? 'text-dangerText' : 'text-textMuted'}>
          {campaign.failedCount} fallidos
        </span>
        <span className="text-textMuted"> de {campaign.totalRecipients}</span>
      </p>
      {campaign.blockedCount > 0 && (
        <p className="text-xs text-textMuted">
          {campaign.blockedCount === 1
            ? '1 bloqueó al bot'
            : `${campaign.blockedCount} bloquearon al bot`}
        </p>
      )}
      {campaign.status === 'SENDING' && (
        <div
          className="h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progreso del envío"
        >
          <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

interface CampaignHistoryProps {
  campaigns: Campaign[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
}

export default function CampaignHistory({
  campaigns,
  total,
  page,
  pageSize,
  isLoading,
  error,
  onPageChange,
}: CampaignHistoryProps) {
  const message =
    isLoading && campaigns.length === 0
      ? { text: 'Cargando campañas…', tone: 'text-textMuted' }
      : error
        ? { text: error, tone: 'text-dangerText' }
        : campaigns.length === 0
          ? { text: 'Todavía no se envió ninguna campaña.', tone: 'text-textMuted' }
          : null;
  const rows = message ? [] : campaigns;

  return (
    <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
              <th className="px-4 py-3 font-medium sm:px-5">Fecha</th>
              <th className="px-4 py-3 font-medium sm:px-5">Campaña</th>
              <th className="px-4 py-3 font-medium sm:px-5">Destinatarios</th>
              <th className="px-4 py-3 font-medium sm:px-5">Resultado</th>
              <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-goldLight/10">
            {message && (
              <tr>
                <td colSpan={5} className={`px-5 py-10 text-center ${message.tone}`}>
                  {message.text}
                </td>
              </tr>
            )}

            {rows.map((campaign) => (
              <tr key={campaign.id} className="align-top transition hover:bg-surface/50 motion-reduce:transition-none">
                <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                  <p className="text-text">{formatCampaignDate(campaign.createdAt)}</p>
                  {campaign.createdByName && <p className="text-xs text-textMuted">por {campaign.createdByName}</p>}
                </td>
                <td className="max-w-[320px] px-4 py-3 sm:px-5">
                  <p className="truncate font-medium text-text">{campaign.title}</p>
                  <p className="line-clamp-2 text-xs text-textMuted">{campaign.message}</p>
                  {campaign.hasImage && <p className="mt-1 text-xs text-goldLight">Con imagen</p>}
                </td>
                <td className="px-4 py-3 text-text sm:px-5">{audienceLabel(campaign.audience)}</td>
                <td className="px-4 py-3 sm:px-5">
                  <Results campaign={campaign} />
                </td>
                <td className="px-4 py-3 sm:px-5">
                  <StatusBadge status={campaign.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lg:hidden">
        {message && <p className={`px-5 py-10 text-center text-sm ${message.tone}`}>{message.text}</p>}

        {rows.length > 0 && (
          <ul className="divide-y divide-goldLight/10">
            {rows.map((campaign) => (
              <li key={campaign.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">{campaign.title}</p>
                    <p className="text-xs text-textMuted">
                      {formatCampaignDate(campaign.createdAt)}
                      {campaign.hasImage ? ' · con imagen' : ''}
                    </p>
                  </div>
                  <StatusBadge status={campaign.status} />
                </div>
                <p className="line-clamp-2 text-sm text-textMuted">{campaign.message}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-textMuted">Destinatarios</dt>
                    <dd className="text-text">{audienceLabel(campaign.audience)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-textMuted">Resultado</dt>
                    <dd>
                      <Results campaign={campaign} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
    </div>
  );
}
