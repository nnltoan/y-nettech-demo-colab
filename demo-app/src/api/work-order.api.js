/**
 * FCC Frontend - Work Order API
 */
import api from './client';

const workOrderApi = {
  /**
   * List work orders with filters
   * @param {Object} filters - { date, shift, workcenter_id, state, approval_state, limit }
   */
  async list(filters = {}) {
    const res = await api.get('/workorders', filters);
    return res.data;
  },

  /**
   * Get work order detail (includes NG details, downtime entries, overtime)
   * @param {number} id - Work Order ID
   */
  async getDetail(id) {
    const res = await api.get(`/workorders/${id}`);
    return res.data;
  },

  /**
   * Submit production report (main endpoint)
   *
   * @param {Object} report - Full production report
   * @param {number} report.workcenter_id - Machine ID
   * @param {number} report.product_id - Product ID
   * @param {string} report.shift - 'ca_1', 'ca_2', 'ca_3'
   * @param {string} report.date - '2026-04-13'
   * @param {string} report.lot_number - Lot number
   * @param {Object} report.operator - { id, name }
   * @param {Object} report.leader - { id, name }
   * @param {Object} report.quantities - { ok, ng, ng_test, ng_pending }
   * @param {Array}  report.ng_details - [{ reason_code, root_cause_code, root_cause_category, countermeasure_code, qty, note }]
   * @param {Array}  report.downtime_entries - [{ reason_code, planned_minutes, actual_minutes, is_planned, start_time, end_time, note }]
   * @param {Array}  report.overtime_entries - [{ reason_code, minutes, operator_ids, note }]
   */
  async submitReport(report) {
    const res = await api.post('/workorders/report', report);
    return res.data;
  },
};

export default workOrderApi;

/**
 * NG Defect codes (D01-D12, D99) — matching Odoo ng.detail model
 */
export const NG_CODES = [
  { code: 'D01', name: 'Lỗi kích thước', nameJP: '寸法不良' },
  { code: 'D02', name: 'Lỗi bề mặt', nameJP: '表面不良' },
  { code: 'D03', name: 'Lỗi hình dạng', nameJP: '形状不良' },
  { code: 'D04', name: 'Lỗi lệch tâm', nameJP: '芯ズレ' },
  { code: 'D05', name: 'Lỗi ren', nameJP: 'ネジ不良' },
  { code: 'D06', name: 'Lỗi độ cứng', nameJP: '硬度不良' },
  { code: 'D07', name: 'Lỗi mẻ/nứt', nameJP: '欠け・割れ' },
  { code: 'D08', name: 'Lỗi ba via', nameJP: 'バリ' },
  { code: 'D09', name: 'Lỗi lắp ghép', nameJP: '組立不良' },
  { code: 'D10', name: 'Lỗi vật liệu', nameJP: '材料不良' },
  { code: 'D11', name: 'Lỗi nhiệt luyện', nameJP: '熱処理不良' },
  { code: 'D12', name: 'Lỗi mạ/phủ', nameJP: 'メッキ不良' },
  { code: 'D99', name: 'Lỗi khác', nameJP: 'その他' },
];

/**
 * Root cause 4M codes (M01-M15)
 */
export const ROOT_CAUSE_CODES = [
  { code: 'M01', category: 'man', name: 'Sai thao tác' },
  { code: 'M02', category: 'man', name: 'Thiếu kinh nghiệm' },
  { code: 'M03', category: 'machine', name: 'Dao cụ mòn' },
  { code: 'M04', category: 'machine', name: 'Máy rung' },
  { code: 'M05', category: 'machine', name: 'Thông số sai' },
  { code: 'M06', category: 'machine', name: 'Jig/Fixture sai' },
  { code: 'M07', category: 'machine', name: 'Calibration sai' },
  { code: 'M08', category: 'material', name: 'Vật liệu lỗi' },
  { code: 'M09', category: 'material', name: 'Sai spec' },
  { code: 'M10', category: 'material', name: 'Độ ẩm/nhiệt' },
  { code: 'M11', category: 'method', name: 'Chương trình CNC sai' },
  { code: 'M12', category: 'method', name: 'Điều kiện cắt sai' },
  { code: 'M13', category: 'method', name: 'Quy trình sai' },
  { code: 'M14', category: 'method', name: 'Thiếu kiểm tra' },
  { code: 'M15', category: 'method', name: 'Bản vẽ không rõ' },
];

/**
 * Countermeasure codes (A01-A10, A99)
 */
export const COUNTERMEASURE_CODES = [
  { code: 'A01', name: 'Đào tạo lại operator' },
  { code: 'A02', name: 'Thay dao cụ' },
  { code: 'A03', name: 'Sửa chữa máy' },
  { code: 'A04', name: 'Chỉnh thông số' },
  { code: 'A05', name: 'Thay jig/fixture' },
  { code: 'A06', name: 'Hiệu chuẩn máy' },
  { code: 'A07', name: 'Đổi lô vật liệu' },
  { code: 'A08', name: 'Sửa chương trình CNC' },
  { code: 'A09', name: 'Cập nhật quy trình' },
  { code: 'A10', name: 'Thêm bước kiểm tra' },
  { code: 'A99', name: 'Giải pháp khác' },
];

/**
 * Downtime reason codes (DT01-DT14)
 */
export const DOWNTIME_CODES = [
  { code: 'DT01', name: 'Chuyển đổi sản phẩm', isPlanned: true, defaultMinutes: 30 },
  { code: 'DT02', name: 'Sửa chữa máy', isPlanned: false, defaultMinutes: 60 },
  { code: 'DT03', name: 'Thiếu nguyên liệu', isPlanned: false, defaultMinutes: 20 },
  { code: 'DT04', name: 'Kiểm tra chất lượng', isPlanned: true, defaultMinutes: 15 },
  { code: 'DT05', name: 'Bảo trì định kỳ', isPlanned: true, defaultMinutes: 45 },
  { code: 'DT06', name: 'Thay dao cụ', isPlanned: true, defaultMinutes: 20 },
  { code: 'DT07', name: 'Lỗi chương trình CNC', isPlanned: false, defaultMinutes: 30 },
  { code: 'DT08', name: 'Mất điện', isPlanned: false, defaultMinutes: 15 },
  { code: 'DT09', name: 'Đo kiểm giữa chừng', isPlanned: true, defaultMinutes: 10 },
  { code: 'DT10', name: 'Chờ hướng dẫn', isPlanned: false, defaultMinutes: 20 },
  { code: 'DT11', name: 'Vệ sinh máy', isPlanned: true, defaultMinutes: 15 },
  { code: 'DT12', name: 'Nghỉ giải lao', isPlanned: true, defaultMinutes: 10 },
  { code: 'DT13', name: 'Đào tạo OJT', isPlanned: true, defaultMinutes: 30 },
  { code: 'DT14', name: 'Lý do khác', isPlanned: false, defaultMinutes: 15 },
];

/**
 * Overtime reason codes (OT01-OT06, OT99)
 */
export const OVERTIME_CODES = [
  { code: 'OT01', name: 'Chạy bù sản lượng' },
  { code: 'OT02', name: 'Đơn hàng gấp' },
  { code: 'OT03', name: 'Sửa lỗi NG' },
  { code: 'OT04', name: 'Bảo trì ngoài giờ' },
  { code: 'OT05', name: 'Setup máy cho ca sau' },
  { code: 'OT06', name: 'Đào tạo ngoài giờ' },
  { code: 'OT99', name: 'Lý do khác' },
];
