/**
 * FCC Frontend - HTTP Client
 *
 * Wraps fetch() with:
 * - Auto JWT token from localStorage
 * - JSON request/response handling
 * - Error normalization
 * - Base URL from config
 */
import config from '../config';

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  // ─── Get stored JWT token ───
  _getToken() {
    try {
      return localStorage.getItem(config.tokenKey) || null;
    } catch {
      return null;
    }
  }

  // ─── Core request method ───
  async request(method, path, { body, params, headers = {} } = {}) {
    // Build URL with query params
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
      ).toString();
      if (qs) url += `?${qs}`;
    }

    // Headers
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    const token = this._getToken();
    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    // Make request
    const response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Parse response
    let data;
    try {
      data = await response.json();
    } catch {
      data = { success: false, error: { message: 'Invalid JSON response' } };
    }

    // Handle errors
    if (!response.ok) {
      const error = new Error(data.error?.message || `HTTP ${response.status}`);
      error.code = data.error?.code || 'HTTP_ERROR';
      error.status = response.status;
      error.details = data.error?.details;

      // Auto-logout on 401
      if (response.status === 401) {
        localStorage.removeItem(config.tokenKey);
        localStorage.removeItem(config.userKey);
        window.dispatchEvent(new Event('auth:logout'));
      }

      throw error;
    }

    return data;
  }

  // ─── Shorthand methods ───
  get(path, params) {
    return this.request('GET', path, { params });
  }

  post(path, body) {
    return this.request('POST', path, { body });
  }

  put(path, body) {
    return this.request('PUT', path, { body });
  }

  delete(path) {
    return this.request('DELETE', path);
  }
}

// Singleton instance
const api = new ApiClient(config.apiUrl);

export default api;
export { ApiClient };
