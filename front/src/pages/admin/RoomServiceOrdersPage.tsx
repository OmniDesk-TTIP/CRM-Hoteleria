import { useCallback, useEffect, useState } from 'react';
import { changeRoomServiceOrderStatus, listRoomServiceOrders } from '@/services/roomService.service';
import type { RoomServiceOrder, RoomServiceOrderListFilters, RoomServiceOrderStatus } from '@/config/types';
import { RoomServiceOrderStatusBadge, RoomServicePaymentBadge } from '@/components/admin/Badges';
import Pagination from '@/components/admin/Pagination';
import { formatCurrency } from '@/components/admin/spaFormat';

const PAGE_SIZE = 10;

type NextStatus = Exclude<RoomServiceOrderStatus, 'RECEIVED'>;

const STATUS_FILTERS: { value: RoomServiceOrderStatus | 'ALL'; label: string }[] = [
  { value: 'RECEIVED', label: 'Recibidos' },
  { value: 'IN_PREPARATION', label: 'En preparación' },
  { value: 'DELIVERED', label: 'Entregados' },
  { value: 'CANCELLED', label: 'Cancelados' },
  { value: 'ALL', label: 'Todos' },
];

const ACTIONS: Record<RoomServiceOrderStatus, { status: NextStatus; label: string }[]> = {
  RECEIVED: [
    { status: 'IN_PREPARATION', label: 'En preparación' },
    { status: 'CANCELLED', label: 'Cancelar' },
  ],
  IN_PREPARATION: [
    { status: 'DELIVERED', label: 'Entregado' },
    { status: 'CANCELLED', label: 'Cancelar' },
  ],
  DELIVERED: [],
  CANCELLED: [],
};

const inputClasses =
  'rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

const advanceButtonClasses =
  'rounded-full border border-success/40 px-3 py-1.5 text-xs font-medium text-successText transition hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const cancelButtonClasses =
  'rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-dangerText transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const formatDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';

function OrderItems({ order }: { order: RoomServiceOrder }) {
  return (
    <ul className="space-y-0.5">
      {order.items.map((item) => (
        <li key={item.menuItemId} className="text-text">
          {item.quantity} × {item.name}
          {item.notes && <span className="text-textMuted"> ({item.notes})</span>}
        </li>
      ))}
      {order.notes && <li className="text-xs text-textMuted">“{order.notes}”</li>}
    </ul>
  );
}

export default function RoomServiceOrdersPage() {
  const [filters, setFilters] = useState<RoomServiceOrderListFilters>({
    status: 'ALL',
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [orders, setOrders] = useState<RoomServiceOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listRoomServiceOrders(filters);
      setOrders(result.items);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar los pedidos de room service.'));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleChangeStatus = async (order: RoomServiceOrder, status: NextStatus) => {
    if (status === 'CANCELLED' && !window.confirm(`¿Cancelar el pedido de la habitación ${order.roomNumber}?`)) {
      return;
    }
    setActionError(null);
    setBusyId(order.id);
    try {
      await changeRoomServiceOrderStatus(order.id, status);
      await fetchOrders();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'No se pudo actualizar el pedido.'));
    } finally {
      setBusyId(null);
    }
  };

  const message = isLoading
    ? { text: 'Cargando pedidos…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : orders.length === 0
        ? { text: 'No hay pedidos de room service para mostrar.', tone: 'text-textMuted' }
        : null;
  const rows = message ? [] : orders;

  const renderActions = (order: RoomServiceOrder, fill = false) =>
    ACTIONS[order.status].map((action) => (
      <button
        key={action.status}
        type="button"
        disabled={busyId === order.id}
        onClick={() => handleChangeStatus(order, action.status)}
        className={`${action.status === 'CANCELLED' ? cancelButtonClasses : advanceButtonClasses}${fill ? ' flex-1 py-2' : ''}`}
      >
        {action.label}
      </button>
    ));

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-text">Room service</h1>
          <p className="text-sm text-textMuted">
            Pedidos a la habitación que los huéspedes confirman por el chat. Cada cambio de estado se le avisa por
            Chamber.
          </p>
        </div>

        <label className="flex w-full flex-col gap-1 text-sm text-textMuted sm:w-auto">
          Estado
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                status: e.target.value as RoomServiceOrderListFilters['status'],
                page: 1,
              }))
            }
            className={inputClasses}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {actionError}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
                <th className="px-4 py-3 font-medium sm:px-5">Huésped</th>
                <th className="px-4 py-3 font-medium sm:px-5">Habitación</th>
                <th className="px-4 py-3 font-medium sm:px-5">Pedido</th>
                <th className="px-4 py-3 font-medium sm:px-5">Total</th>
                <th className="px-4 py-3 font-medium sm:px-5">Fecha y hora</th>
                <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
                <th className="px-4 py-3 text-right font-medium sm:px-5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-goldLight/10">
              {message && (
                <tr>
                  <td colSpan={7} className={`px-5 py-10 text-center ${message.tone}`}>
                    {message.text}
                  </td>
                </tr>
              )}

              {rows.map((order) => (
                <tr key={order.id} className="align-top transition hover:bg-surface/50 motion-reduce:transition-none">
                  <td className="px-4 py-3 font-medium text-text sm:px-5">{order.guestFullName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text sm:px-5">{order.roomNumber}</td>
                  <td className="min-w-[14rem] max-w-sm px-4 py-3 sm:px-5">
                    <OrderItems order={order} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                    <p className="text-text">{formatCurrency(order.total)}</p>
                    <div className="mt-1">
                      <RoomServicePaymentBadge status={order.paymentStatus} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-textMuted sm:px-5">
                    {formatDateTime(order.confirmedAt)}
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <RoomServiceOrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex justify-end gap-2">{renderActions(order)}</div>
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
              {rows.map((order) => (
                <li key={order.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-text">{order.guestFullName}</p>
                      <p className="text-sm text-textMuted">
                        Habitación {order.roomNumber} · {formatDateTime(order.confirmedAt)}
                      </p>
                    </div>
                    <RoomServiceOrderStatusBadge status={order.status} />
                  </div>

                  <div className="text-sm">
                    <OrderItems order={order} />
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-text">{formatCurrency(order.total)}</span>
                    <RoomServicePaymentBadge status={order.paymentStatus} />
                  </div>

                  {ACTIONS[order.status].length > 0 && <div className="flex gap-2">{renderActions(order, true)}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
        />
      </div>
    </div>
  );
}
