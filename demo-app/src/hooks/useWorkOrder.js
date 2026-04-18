/**
 * FCC Frontend - Work Order Hook
 * Manages production report submission and work order queries
 */
import { useState, useCallback } from 'react';
import workOrderApi from '../api/work-order.api';

/**
 * Hook for submitting production reports
 */
export function useSubmitReport() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = useCallback(async (report) => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await workOrderApi.submitReport(report);
      setResult(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, result, error };
}

/**
 * Hook for listing work orders
 */
export function useWorkOrders(initialFilters = {}) {
  const [workorders, setWorkorders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (filters = initialFilters) => {
    setLoading(true);
    try {
      const data = await workOrderApi.list(filters);
      setWorkorders(data);
      return data;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { workorders, loading, error, load };
}

export default useSubmitReport;
