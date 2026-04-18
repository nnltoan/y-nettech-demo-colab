/**
 * FCC Frontend - Report & Approval API
 */
import api from './client';

export const reportApi = {
  /** Daily production summary */
  async getDailySummary(date) {
    const res = await api.get('/reports/daily', { date });
    return res.data;
  },

  /** NG defect analysis */
  async getNGAnalysis(from, to) {
    const res = await api.get('/reports/ng', { from, to });
    return res.data;
  },

  /** Downtime analysis */
  async getDowntimeAnalysis(from, to) {
    const res = await api.get('/reports/downtime', { from, to });
    return res.data;
  },

  /** OEE calculation */
  async getOEE(date, workcenterId) {
    const res = await api.get('/reports/oee', { date, workcenter_id: workcenterId });
    return res.data;
  },
};

/**
 * Approval workflow (5 states):
 *   draft → submitted → leader_approved → chief_approved
 *                    ↓                  ↓
 *                rejected ← ─ ─ ─ ─ ─ ─ ┘
 *
 * Luồng thường gặp:
 *   1. Operator điền form → bấm Submit → POST /workorders/report (auto state='submitted')
 *   2a. Operator đổi ý → bấm Rút lại → withdraw() → state='draft'
 *   2b. Leader thấy trong danh sách pending → Approve → leaderApprove()
 *   2c. Leader reject với comment → reject() → state='rejected'
 *   3. Manager mở Odoo → Approve hoặc Reject
 *   4. Nếu bị reject → Operator bấm Reset → resetToDraft() → sửa + submit lại
 */
export const approvalApi = {
  /**
   * Leader xem danh sách WO chờ duyệt (state = 'submitted')
   * Manager xem danh sách WO đã qua Leader (state = 'leader_approved')
   */
  async getPending(role = 'leader') {
    const res = await api.get('/approval/pending', { role });
    return res.data;
  },

  /** Get current approval state + allowed next transitions */
  async getStatus(woId) {
    const res = await api.get(`/approval/${woId}`);
    return res.data;
  },

  /**
   * Operator submit báo cáo lên Leader: draft → submitted
   * Thường KHÔNG cần gọi trực tiếp — POST /workorders/report đã tự set 'submitted'
   * Chỉ dùng khi WO đang ở state 'draft' (đã save as draft trước đó)
   */
  async submit(woId) {
    const res = await api.post(`/approval/${woId}/submit`);
    return res.data;
  },

  /**
   * Operator rút lại báo cáo TRƯỚC KHI Leader duyệt: submitted → draft
   * Dùng khi operator nhận ra nhập sai nhưng Leader chưa kịp approve
   */
  async withdraw(woId) {
    const res = await api.post(`/approval/${woId}/withdraw`);
    return res.data;
  },

  /** Leader approves (App): submitted → leader_approved */
  async leaderApprove(woId, comment = '') {
    const res = await api.post(`/approval/${woId}/leader-approve`, { comment });
    return res.data;
  },

  /**
   * Reject WO — yêu cầu comment. Dùng bởi cả Leader (App) và Manager (Odoo)
   * submitted → rejected (Leader)
   * leader_approved → rejected (Manager)
   */
  async reject(woId, comment) {
    if (!comment) throw new Error('Comment là bắt buộc khi reject');
    const res = await api.post(`/approval/${woId}/reject`, { comment });
    return res.data;
  },

  /** Reset rejected WO về draft để operator sửa lại */
  async resetToDraft(woId) {
    const res = await api.post(`/approval/${woId}/reset`);
    return res.data;
  },
};

export default { ...reportApi, ...approvalApi };
