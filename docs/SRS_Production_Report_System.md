# Đặc Tả Yêu Cầu Phần Mềm (SRS)
## Hệ Thống Báo Cáo Sản Xuất Hàng Ngày — Smart Factory 4.0

**Phiên bản:** v2.0  
**Ngày:** 2026-04-19  
**Trạng Thái:** Production Draft  
**Tác Giả:** DanaExperts & Y-Nettech  
**Khách Hàng:** Nhà Máy Sản Xuất Nhật Bản (Giai Đoạn 1: CNC 4 máy, 20 người dùng)

---

## 1. Giới Thiệu

### 1.1 Mục Đích

Tài liệu này định nghĩa các yêu cầu phần mềm chi tiết cho **Hệ Thống Báo Cáo Sản Xuất Hàng Ngày** (Production Daily Report System) — một giải pháp quản lý sản xuất tích hợp giữa DanaExperts (ERP/Odoo) và Y-Nettech (IoT/Tự động hóa).

**Mục Tiêu Chính:**
- Thay thế quy trình báo cáo trên giấy bằng hệ thống điện tử trên tablet
- Cung cấp quy trình phê duyệt 2 cấp (Sub Leader + Chief) có kiểm soát
- Hỗ trợ 6 vai trò khác nhau với quyền hạn cụ thể
- Tích hợp dữ liệu kế hoạch sản xuất từ ERP
- Tạo nền tảng cho IoT phase (Phase 2+)

### 1.2 Phạm Vi

**Phase 1 — CNC Department Pilot:**
- **Máy:** 4 máy CNC (TIEN01, PHAY01, PHAY02, OTHER)
- **Nhân lực:** 20 người gồm:
  - 12 Operators (OP001-OP012, 4 người/shift × 3 shift)
  - 3 Sub Leaders (SL001-SL003, 1 người/shift)
  - 1 Chief (CH001)
  - 1 Director (DIR001)
  - 1 QA (QA001)
  - 1 Maintenance (MNT001)
  - 1 Planner (PL001)

**Sản Phẩm:** 3 loại (SP-A, SP-B, SP-C)

**Bao Gồm (Phase 1):**
- Nhập báo cáo sản xuất hàng ngày qua tablet
- Quy trình phê duyệt 2 cấp (submitted → leader_approved → chief_approved)
- Dashboard dựa trên vai trò (6 loại)
- Danh sách báo cáo với filter & search
- Chi tiết báo cáo & lịch sử
- Kế hoạch sản xuất tháng
- Phân tích OEE, NG trends, downtime
- i18n: Tiếng Việt & Tiếng Nhật

**Không Bao Gồm (Phase 2+):**
- IoT sensor integration
- Offline mode & sync
- Mobile app (React Native)
- Advanced predictive analytics

### 1.3 Thuật Ngữ

| Thuật Ngữ | Định Nghĩa |
|-----------|-----------|
| **BM-02** | Form báo cáo sản xuất hàng ngày (standard form) |
| **OEE** | Overall Equipment Effectiveness (Hiệu suất Thiết bị Tổng hợp) |
| **NG** | Không Đạt (Not Good / Defective) |
| **Master Data** | Dữ liệu tham chiếu (machines, products, codes, users) |
| **Workflow** | Quy trình phê duyệt báo cáo |
| **Role** | Vai trò người dùng (Operator, Sub Leader, Chief, etc.) |

---

## 2. Mô Tả Tổng Quan Hệ Thống

### 2.1 Kiến Trúc Hệ Thống

```
Tablet (React 18 PWA)
   ↓
localStorage (Phase 1) / Node.js Middleware (Phase 2)
   ↓
Odoo 17 (fcc_manufacturing module)
   ↓
PostgreSQL Database
```

### 2.2 Đặc Tính Chính

- **React 18 Single-Page Application** (App.jsx ~7800 lines)
- **Tailwind CSS** responsive design
- **localStorage** persistent storage (cache busting with DATA_VERSION)
- **Recharts** for OEE visualization
- **Lucide Icons** for UI
- **PWA-ready** (manifest.json + service worker for Phase 2)
- **Bilingual:** Vietnamese & Japanese

### 2.3 Ràng Buộc & Giới Hạn (Constraints)

1. **No Personal Phones:** Nhà máy không cho phép điện thoại cá nhân → dùng tablet
2. **Shared Tablets:** 4-6 tablet cho 12+ operators → multi-user session
3. **No Internet Dependency (Phase 1):** localStorage only, works offline
4. **Touch-First Design:** min 44px buttons, large tap targets
5. **Factory Environment:** Must work in industrial setting (dust, vibration, humidity)

---

## 3. Yêu Cầu Chức Năng (Functional Requirements)

### 3.1 FR-01: Authentication & User Management

**Requirement:** Xác thực người dùng & quản lý phiên làm việc

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-01.1 | Login screen hiển thị danh sách người dùng (20 người) | M |
| FR-01.2 | Chọn người dùng → tải quyền hạn & dashbaord của họ | M |
| FR-01.3 | Logout → quay lại login screen | M |
| FR-01.4 | Session persistent (localStorage 'prs_current_user') | M |
| FR-01.5 | Multi-device support (tablet + desktop) | M |

**Notes:**
- Phase 1: No password, just select user (demo mode)
- Phase 2: Odoo session token-based auth

### 3.2 FR-02: Report Creation & Editing (BM-02)

**Requirement:** Tạo & chỉnh sửa báo cáo sản xuất

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-02.1 | Form BM-02 với header (machine, date, shift, operator) | M |
| FR-02.2 | Line items: 3-10 products (Planned, Good, NG qty) | M |
| FR-02.3 | NG Sub-table: NG codes (D01-D12+D99), root cause (M01-M15), countermeasures (A01-A10+A99) | M |
| FR-02.4 | Downtime section: reasons (DT01-DT14), duration | M |
| FR-02.5 | Overtime section: reasons (OT01-OT07), hours | M |
| FR-02.6 | Save draft locally (localStorage) | M |
| FR-02.7 | Auto-calculate NG Qty = Planned - Good | M |
| FR-02.8 | Validation: required fields, numeric validation | M |
| FR-02.9 | Timestamps: created_at, submitted_at, approved_at auto-filled | M |

**Validation Rules:**
- Machine ID, Report Date, Shift: required
- Good Qty ≤ Planned Qty
- Total NG = sum of line NG qty = Planned - Good
- NG Sub-table: only if NG Qty > 0

### 3.3 FR-03: Approval Workflow (5 Statuses, NO QA)

**Requirement:** 2-cấp phê duyệt (Sub Leader → Chief). QA & Maintenance là VIEW-ONLY.

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-03.1 | 5 statuses: draft, submitted, leader_approved, chief_approved, rejected | M |
| FR-03.2 | Operator submit → status = submitted | M |
| FR-03.3 | Sub Leader approve → status = leader_approved (Level 1) | M |
| FR-03.4 | Sub Leader reject → status = rejected (với reason) | M |
| FR-03.5 | Chief approve → status = chief_approved (Level 2, final) | M |
| FR-03.6 | Chief reject → status = rejected (với reason) | M |
| FR-03.7 | NO qa_approved status (QA is VIEW-ONLY, no approve button) | M |
| FR-03.8 | QA & Maintenance: xem danh sách báo cáo (approved only) | M |
| FR-03.9 | Rejected report: operator có thể sửa & resubmit | M |
| FR-03.10 | SLA: submitted→leader (8h), leader→chief (24h) | S |
| FR-03.11 | Approval notifications (Phase 2: email/in-app) | S |

**Workflow Diagram:**
```
draft → submitted → leader_approved → chief_approved
                 ↓                  ↓
              rejected ← operator sửa & resubmit
```

**Critical:** QA & Maintenance role:
- Can view reports list & details
- **NO** approve/reject buttons
- **NO** participation in workflow
- Read-only access

### 3.4 FR-04: Dashboards (6 Role-Based)

**Requirement:** Hiển thị KPI & dữ liệu khác nhau tùy vai trò

| Role | Dashboard Content |
|------|-------------------|
| Operator | Báo cáo hôm nay của mình, OEE máy tôi, tạo báo cáo mới |
| Sub Leader | Báo cáo ca tôi phụ trách, chờ duyệt, nút approve/reject |
| Chief | Tất cả báo cáo, chờ duyệt Level 2, approve/reject |
| Director | KPI tổng hợp (OEE, Uptime, Quality), trend NG%, downtime% |
| QA | Danh sách báo cáo (approved only), thống kê NG, **NO approve** |
| Maintenance | Danh sách báo cáo (approved only), thống kê downtime, **NO approve** |

### 3.5 FR-05: Reports List & Search

**Requirement:** Xem danh sách báo cáo với filter, sort, export

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-05.1 | Hiển thị danh sách toàn bộ báo cáo (nếu có quyền) | M |
| FR-05.2 | Filter: Machine, Status, Date Range, Shift | M |
| FR-05.3 | Sort: Date, Machine, Status | M |
| FR-05.4 | Search: operator name, machine ID | M |
| FR-05.5 | Pagination: 20 items/page | M |
| FR-05.6 | Export CSV/Excel (Phase 2) | S |

### 3.6 FR-06: Report Detail & History

**Requirement:** Xem chi tiết 1 báo cáo & lịch sử phê duyệt

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-06.1 | Hiển thị tất cả header, line items, NG details | M |
| FR-06.2 | Hiển thị downtime & overtime chi tiết | M |
| FR-06.3 | Hiển thị lịch sử: submitted_at, leader_approved_at, chief_approved_at | M |
| FR-06.4 | Hiển thị approval comments (nếu reject) | M |
| FR-06.5 | OEE calculation: Availability, Performance, Quality | M |
| FR-06.6 | Nút "Approve", "Reject" (nếu role có quyền) | M |

### 3.7 FR-07: Monthly Plan

**Requirement:** Xem kế hoạch sản xuất tháng

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-07.1 | Tải kế hoạch từ Odoo KHSX (Phase 2) | M |
| FR-07.2 | Hiển thị: Machine, Product, Planned Qty (total month) | M |
| FR-07.3 | So sánh: Planned vs Actual cumulative | M |
| FR-07.4 | Trend line chart: monthly vs daily actual | S |

### 3.8 FR-08: Analytics

**Requirement:** Biểu đồ & phân tích dữ liệu

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-08.1 | OEE chart: daily/weekly trend per machine | M |
| FR-08.2 | NG breakdown pie chart: by NG code | M |
| FR-08.3 | Downtime bar chart: by reason | M |
| FR-08.4 | Root cause bar chart: by 4M category | M |
| FR-08.5 | Availability, Performance, Quality trends | M |

**Charts:** Recharts (LineChart, BarChart, PieChart)

### 3.9 FR-09: IFS Integration (Phase 2)

**Requirement:** Kế nối với hệ thống IFS

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-09.1 | Export báo cáo → IFS format | S |
| FR-09.2 | Sync dữ liệu (bi-directional) | S |

**Note:** Placeholder for Phase 2, not in scope of Phase 1 demo

### 3.10 FR-10: Internationalization (i18n)

**Requirement:** Hỗ trợ 2 ngôn ngữ

| ID | Yêu Cầu | Trạng Thái |
|----|--------|----------|
| FR-10.1 | UI labels: Tiếng Việt & Tiếng Nhật | M |
| FR-10.2 | Form fields: bilingual placeholders | M |
| FR-10.3 | NG codes, root causes, countermeasures: JP + VN | M |
| FR-10.4 | Language toggle: switch at any time | M |

---

## 4. Yêu Cầu Phi Chức Năng (Non-Functional Requirements)

### 4.1 Performance

| ID | Yêu Cầu | Target |
|----|--------|--------|
| NFR-01.1 | Page load time | < 2s |
| NFR-01.2 | Report form submit | < 500ms |
| NFR-01.3 | Dashboard render | < 1s |
| NFR-01.4 | Search/filter response | < 500ms |

### 4.2 Usability

| ID | Yêu Cầu | Chi Tiết |
|----|--------|---------|
| NFR-02.1 | Touch-friendly UI | min 44px tap targets |
| NFR-02.2 | Responsive design | 375px - 1920px |
| NFR-02.3 | Intuitive navigation | 12 screens, clear hierarchy |
| NFR-02.4 | Form validation feedback | inline errors, success messages |
| NFR-02.5 | Accessibility (WCAG 2.1 AA) | color contrast, keyboard nav |

### 4.3 Reliability & Availability

| ID | Yêu Cầu | Target |
|----|--------|--------|
| NFR-03.1 | Uptime | 99.5% |
| NFR-03.2 | Data backup | daily |
| NFR-03.3 | Disaster recovery | 1-hour RTO |
| NFR-03.4 | localStorage cache busting | DATA_VERSION sync |

### 4.4 Security

| ID | Yêu Cầu | Chi Tiết |
|----|--------|---------|
| NFR-04.1 | HTTPS/TLS | all traffic encrypted |
| NFR-04.2 | CORS policy | restricted origins |
| NFR-04.3 | Input validation | server & client-side |
| NFR-04.4 | XSS protection | sanitize HTML input |
| NFR-04.5 | Audit trail | all actions logged (Phase 2) |

### 4.5 Scalability

| ID | Yêu Cầu | Chi Tiết |
|----|--------|---------|
| NFR-05.1 | Phase 1 scale | 4 machines, 20 users |
| NFR-05.2 | Phase 2 scale | 150 machines, 500+ users |
| NFR-05.3 | Database optimization | indexing, pagination |
| NFR-05.4 | Async operations | report export, batch approvals |

### 4.6 Maintainability

| ID | Yêu Cầu | Chi Tiết |
|----|--------|---------|
| NFR-06.1 | Code structure | React components, hooks pattern |
| NFR-06.2 | Documentation | inline comments, README |
| NFR-06.3 | Testing | unit & integration tests |
| NFR-06.4 | Version control | Git with clear commit messages |

---

## 5. Mô Hình Dữ Liệu

### 5.1 Report Schema

```javascript
{
  id: string (UUID),
  machineId: string (TIEN01|PHAY01|PHAY02|OTHER),
  reportDate: date (YYYY-MM-DD),
  shift: number (1|2|3),
  operatorId: string (OP001-OP012),
  status: enum (draft|submitted|leader_approved|chief_approved|rejected),
  
  lineItems: [{
    productCode: string (SP-A|SP-B|SP-C),
    plannedQty: number,
    goodQty: number,
    ngQty: number (calculated = plannedQty - goodQty)
  }],
  
  ngDetails: [{
    ngCode: string (D01-D12|D99),
    quantity: number,
    rootCause: string (M01-M15),
    countermeasure: string (A01-A10|A99)
  }],
  
  downtime: [{
    reason: string (DT01-DT14),
    startTime: time (HH:MM),
    endTime: time (HH:MM),
    durationMins: number (calculated)
  }],
  
  overtime: [{
    reason: string (OT01-OT07),
    hours: number
  }],
  
  createdAt: timestamp,
  submittedAt: timestamp,
  leaderApprovedAt: timestamp,
  chiefApprovedAt: timestamp,
  rejectedAt: timestamp,
  rejectionReason: string (if rejected)
}
```

### 5.2 User Schema

```javascript
{
  id: string (OP001|SL001|CH001|DIR001|QA001|MNT001|PL001),
  name: string,
  role: enum (operator|sub_leader|chief|director|qa|maintenance|planner),
  machineIds: string[] (assigned machines),
  shiftIds: number[] (1|2|3),
  language: enum (vi|ja)
}
```

### 5.3 Master Data Schema

```javascript
machines: [{
  id: string (TIEN01|PHAY01|PHAY02|OTHER),
  name: string,
  type: string (CNC|other)
}],

products: [{
  code: string (SP-A|SP-B|SP-C),
  name: string,
  dailyTarget: number
}],

ngCodes: [{
  code: string (D01-D12|D99),
  nameJp: string,
  nameVi: string
}],

rootCauses: [{
  code: string (M01-M15),
  category: enum (man|machine|material|method|environment),
  nameVi: string
}],

countermeasures: [{
  code: string (A01-A10|A99),
  nameVi: string
}],

downtimeReasons: [{
  code: string (DT01-DT14),
  nameVi: string
}],

overtimeReasons: [{
  code: string (OT01-OT07),
  nameVi: string
}]
```

---

## 6. Phụ Lục

### 6.1 Master Data Catalog

**NG Codes (D01-D12 + D99):**
- D01: 寸法不良 / Lỗi kích thước
- D02: 表面不良 / Lỗi bề mặt
- ... (13 total)

**Root Causes (M01-M15 + 4M):**
- Man (M01-M03): Kỹ năng, mệt mỏi, chú ý
- Machine (M04-M06): Bảo dưỡng, chính xác, lỗi
- Material (M07-M09): Chất lượng, lô, bảo quản
- Method (M10-M12): Quy trình, công cụ, setup
- Environment (M13-M15): Nhiệt độ, độ ẩm, bụi

**Countermeasures (A01-A10 + A99):**
- A01-A10: Training, Maint, Tool, QC, Setup, Clean, Repair, Environment, Calibration, Material
- A99: Other

### 6.2 Permissions Matrix

| Role | Create | Edit | Submit | Approve L1 | Approve L2 | View All | View Own |
|------|--------|------|--------|-----------|-----------|----------|----------|
| Operator | ✓ | ✓ (draft) | ✓ | ✗ | ✗ | ✗ | ✓ |
| Sub Leader | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ (own shift) | ✗ |
| Chief | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ (all) | ✗ |
| Director | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (dashboard) | ✗ |
| QA | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (approved only) | ✗ |
| Maintenance | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (approved only) | ✗ |
| Planner | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (dashboard) | ✗ |

### 6.3 OEE Calculation Reference

```
Availability = (Planned Time - Downtime) / Planned Time
Performance = Actual Output / Planned Output
Quality = Good Output / (Good + NG Output)
OEE = Availability × Performance × Quality
```

**Targets:**
- Availability ≥ 90%
- Performance ≥ 90%
- Quality ≥ 99%
- OEE ≥ 80%

### 6.4 Roles & Team Structure

```
Director (DIR001)
  ├── Chief (CH001)
  │   ├── Sub Leader Shift 1 (SL001)
  │   │   ├── Operator 1 (OP001)
  │   │   ├── Operator 2 (OP002)
  │   │   └── Operator 3 (OP003)
  │   ├── Sub Leader Shift 2 (SL002)
  │   │   └── ... (OP005-OP008)
  │   └── Sub Leader Shift 3 (SL003)
  │       └── ... (OP009-OP012)
  ├── QA (QA001) — VIEW-ONLY
  ├── Maintenance (MNT001) — VIEW-ONLY
  └── Planner (PL001)
```

### 6.5 Acceptance Criteria (Demo Phase)

**Functional:**
- [x] All 12 screens functional
- [x] 5-status workflow implemented (no qa_approved)
- [x] 2-level approval (Sub Leader + Chief)
- [x] QA & Maintenance VIEW-ONLY (no approve buttons)
- [x] BM-02 form complete with all sections
- [x] OEE calculation validated
- [x] i18n working (VN + JP)
- [x] localStorage persistence verified

**Non-Functional:**
- [x] Touch-friendly (44px min buttons)
- [x] Responsive (375px - 1920px)
- [x] < 2s page load
- [x] No console errors
- [x] Data validation working

**Documentation:**
- [x] User manual (Vietnamese)
- [x] Demo video (8 scenes, 10-13 min)
- [x] SRS v2.0
- [x] Basic Design v2.0
- [x] Plan Demo v2.0

---

**End of Document — IEEE 830 Compliance**
