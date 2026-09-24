import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { AlertCounts, AlertPublic, AlertStatus } from '@xeno/shared';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { toast } from '@/ui';

export type AlertFilter = 'active' | 'all';
const STATUSES: Record<AlertFilter, AlertStatus[] | undefined> = {
  active: ['open', 'acknowledged'],
  all: undefined,
};

type Page = { items: AlertPublic[]; nextCursor: string | null };

export function useAlerts(filter: AlertFilter) {
  return useInfiniteQuery({
    queryKey: qk.alerts(filter),
    queryFn: ({ pageParam }) =>
      api.alerts.list({ status: STATUSES[filter], cursor: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Page) => last.nextCursor,
  });
}

/** Ack/resolve with optimistic list updates and badge-count adjustment. */
export function useAlertActions() {
  const qc = useQueryClient();

  const patch = (id: string, fn: (a: AlertPublic) => AlertPublic | null) => {
    for (const filter of ['active', 'all'] as const) {
      qc.setQueryData<InfiniteData<Page>>(qk.alerts(filter), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.flatMap((a) => {
                  if (a.id !== id) return [a];
                  const next = fn(a);
                  if (!next) return [];
                  return filter === 'active' && next.status === 'resolved' ? [] : [next];
                }),
              })),
            }
          : data,
      );
    }
  };

  const options = (kind: 'ack' | 'resolve') => ({
    mutationFn: (a: AlertPublic) =>
      kind === 'ack' ? api.alerts.ack(a.id) : api.alerts.resolve(a.id),
    onMutate: (a: AlertPublic) => {
      const now = new Date().toISOString();
      patch(a.id, (x) =>
        kind === 'ack'
          ? { ...x, status: 'acknowledged', acknowledgedAt: now }
          : { ...x, status: 'resolved', resolvedAt: now },
      );
      if (a.status === 'open') {
        qc.setQueryData<AlertCounts>(qk.alertCounts, (c) =>
          c ? { ...c, open: Math.max(0, c.open - 1) } : c,
        );
      }
    },
    onError: (err: unknown) => {
      toast.error('Could not update the alert', errorMessage(err));
      void qc.invalidateQueries({ queryKey: qk.alertsAll });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.alertCounts }),
  });

  const ack = useMutation(options('ack'));
  const resolve = useMutation(options('resolve'));
  return { ack, resolve };
}
