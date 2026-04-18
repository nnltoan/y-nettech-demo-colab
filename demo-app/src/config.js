/**
 * FCC Frontend - Configuration
 * Uses Vite environment variables (VITE_ prefix)
 */
const config = {
  // Middleware API URL — tự detect host để hoạt động cả localhost và IP (tablet)
  apiUrl: import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001/api/v1`,

  // App settings
  appName: 'FCC Production Report',
  version: '1.0.0',

  // Token storage key
  tokenKey: 'fcc_token',
  userKey: 'fcc_user',

  // Shifts
  shifts: [
    { value: 'ca_1', label: 'Ca 1 (06:00 - 14:00)' },
    { value: 'ca_2', label: 'Ca 2 (14:00 - 22:00)' },
    { value: 'ca_3', label: 'Ca 3 (22:00 - 06:00)' },
  ],
};

export default config;
