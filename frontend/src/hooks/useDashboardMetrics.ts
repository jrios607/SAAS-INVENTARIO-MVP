import { useState, useEffect, useCallback } from 'react';
import { getDashboardKPIs, DashboardKPIs } from '@/services/api';

export function useDashboardMetrics() {
  const [data, setData] = useState<DashboardKPIs | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getDashboardKPIs();
      if (!res) {
        throw new Error('No data returned from API');
      }
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Error cargando las métricas del dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { data, isLoading, error, refetch: fetchMetrics };
}
