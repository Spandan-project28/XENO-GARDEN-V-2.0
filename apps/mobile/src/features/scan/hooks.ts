import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScanPublic } from '@xeno/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useScanStatus() {
  return useQuery({ queryKey: qk.scanStatus, queryFn: api.scans.status, staleTime: 60_000 });
}

export function useScans(limit = 20) {
  return useQuery({ queryKey: qk.scans(), queryFn: () => api.scans.list({ limit }) });
}

/** One scan; opens instantly from the list cache. */
export function useScan(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.scan(id),
    queryFn: () => api.scans.get(id),
    initialData: () => qc.getQueryData<{ items: ScanPublic[] }>(qk.scans())?.items.find((s) => s.id === id),
  });
}

export function useDeleteScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.scans.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.scansAll }),
  });
}

/** After a new scan: put it in the cache so the result screen opens without a request. */
export function rememberScan(qc: ReturnType<typeof useQueryClient>, scan: ScanPublic) {
  qc.setQueryData(qk.scan(scan.id), scan);
  void qc.invalidateQueries({ queryKey: qk.scans() });
}
