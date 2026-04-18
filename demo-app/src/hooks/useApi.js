/**
 * FCC Frontend - Generic API Hook
 * Handles loading, error, and data states for API calls
 */
import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Generic hook for API calls with loading/error state
 *
 * Usage:
 *   const { data, loading, error, execute } = useApi(masterDataApi.getAll);
 *   // Call on mount:
 *   useEffect(() => { execute(); }, []);
 *   // Or call on demand:
 *   <button onClick={() => execute()}>Load</button>
 */
export function useApi(apiFunction) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFunction(...args);
      if (mountedRef.current) {
        setData(result);
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || 'An error occurred');
      }
      throw err;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [apiFunction]);

  return { data, loading, error, execute, setData };
}

/**
 * Hook that auto-fetches on mount
 *
 * Usage:
 *   const { data: products, loading } = useAutoFetch(() => masterDataApi.getProducts());
 */
export function useAutoFetch(apiFunction, deps = []) {
  const { data, loading, error, execute } = useApi(apiFunction);

  useEffect(() => {
    execute();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refresh: execute };
}

export default useApi;
