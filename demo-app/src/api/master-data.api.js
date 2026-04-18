/**
 * FCC Frontend - Master Data API
 */
import api from './client';

const masterDataApi = {
  /** Get all master data (products + machines) — for initial App load */
  async getAll() {
    const res = await api.get('/master/all');
    return res.data; // { products: [...], workcenters: [...] }
  },

  /** Get products list */
  async getProducts() {
    const res = await api.get('/master/products');
    return res.data;
  },

  /** Get work centers (machines) */
  async getWorkCenters() {
    const res = await api.get('/master/workcenters');
    return res.data;
  },

  /** Get Bill of Materials for a product */
  async getBoM(productId) {
    const res = await api.get(`/master/bom/${productId}`);
    return res.data;
  },

  /** Get Manufacturing Orders */
  async getManufacturingOrders(filters = {}) {
    const res = await api.get('/master/mo', filters);
    return res.data;
  },

  /** Clear server cache */
  async clearCache() {
    const res = await api.post('/master/cache/clear');
    return res;
  },
};

export default masterDataApi;
