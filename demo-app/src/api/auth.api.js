/**
 * FCC Frontend - Auth API
 */
import api from './client';
import config from '../config';

const authApi = {
  /**
   * Login operator/leader
   * @param {string} operatorId - e.g. 'OP001'
   * @param {string} pin - e.g. '1234'
   * @returns {{ token, user: { id, name, role, department } }}
   */
  async login(operatorId, pin = '') {
    const res = await api.post('/auth/login', {
      operator_id: operatorId,
      pin,
    });
    // Store token & user
    if (res.data?.token) {
      localStorage.setItem(config.tokenKey, res.data.token);
      localStorage.setItem(config.userKey, JSON.stringify(res.data.user));
    }
    return res.data;
  },

  /**
   * Logout — clear stored token
   */
  logout() {
    localStorage.removeItem(config.tokenKey);
    localStorage.removeItem(config.userKey);
    window.dispatchEvent(new Event('auth:logout'));
  },

  /**
   * Get current user from stored token
   */
  getCurrentUser() {
    try {
      const user = localStorage.getItem(config.userKey);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },

  /**
   * Check if logged in
   */
  isLoggedIn() {
    return !!localStorage.getItem(config.tokenKey);
  },

  /**
   * Get current user from server (verify token)
   */
  async getMe() {
    const res = await api.get('/auth/me');
    return res.data;
  },

  /**
   * Get list of operators
   */
  async getOperators(filters = {}) {
    const res = await api.get('/auth/operators', filters);
    return res.data;
  },
};

export default authApi;
