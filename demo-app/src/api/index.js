/**
 * FCC Frontend - API barrel export
 * Import all APIs from one place:
 *   import { authApi, masterDataApi, workOrderApi } from './api';
 */
export { default as authApi } from './auth.api';
export { default as masterDataApi } from './master-data.api';
export { default as workOrderApi } from './work-order.api';
export { reportApi, approvalApi } from './report.api';
export { NG_CODES, ROOT_CAUSE_CODES, COUNTERMEASURE_CODES, DOWNTIME_CODES, OVERTIME_CODES } from './work-order.api';
