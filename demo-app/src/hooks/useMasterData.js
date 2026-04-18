/**
 * FCC Frontend - Master Data Hook
 * Loads and caches products + machines from Odoo
 */
import { useState, useEffect, useCallback } from 'react';
import masterDataApi from '../api/master-data.api';

/**
 * Load all master data on mount, cache in state
 * Returns { products, workcenters, loading, error, refresh }
 */
export function useMasterData() {
  const [products, setProducts] = useState([]);
  const [workcenters, setWorkcenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await masterDataApi.getAll();
      setProducts(data.products || []);
      setWorkcenters(data.workcenters || []);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load master data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    products,
    workcenters,
    loading,
    error,
    refresh: loadData,

    // Helpers
    getProduct: (id) => products.find(p => p.id === id),
    getWorkcenter: (id) => workcenters.find(wc => wc.id === id),
  };
}

export default useMasterData;
