# Plan: Demo Web App — Production Daily Report (生産日報)

**Dự án**: Smart Factory 4.0 — DanaExperts × Y-Nettech
**Ngày tạo**: 2026-04-05
**Phiên bản**: v1.0
**Tác giả**: DanaExperts Team (BA + Tech Lead + UI/UX)

---

## Mục lục

1. [Tổng quan dự án & bối cảnh](#1-tổng-quan-dự-án--bối-cảnh)
2. [Phân tích hiện trạng (As-Is)](#2-phân-tích-hiện-trạng-as-is)
3. [Yêu cầu từ khách hàng](#3-yêu-cầu-từ-khách-hàng)
4. [Phân tích nghiệp vụ (BA Analysis)](#4-phân-tích-nghiệp-vụ-ba-analysis)
5. [Thiết kế hệ thống Roles & Permissions](#5-thiết-kế-hệ-thống-roles--permissions)
6. [Thiết kế Workflow — Report / Review / Approve / Reject](#6-thiết-kế-workflow)
7. [Thiết kế Form Report chi tiết](#7-thiết-kế-form-report-chi-tiết)
8. [Danh mục lỗi, nguyên nhân, giải pháp (Master Data)](#8-danh-mục-lỗi-nguyên-nhân-giải-pháp-master-data)
9. [Dashboard theo Role](#9-dashboard-theo-role)
10. [Giải pháp thiết bị nhập liệu](#10-giải-pháp-thiết-bị-nhập-liệu)
11. [OEE — Yêu cầu & Quy trình tính](#11-oee--yêu-cầu--quy-trình-tính)
12. [Ước tính chi phí triển khai](#12-ước-tính-chi-phí-triển-khai)
13. [Plan triển khai Demo](#13-plan-triển-khai-demo)
14. [Kịch bản quay Video Demo](#14-kịch-bản-quay-video-demo)
15. [Phụ lục](#15-phụ-lục)

---

## 1. Tổng quan dự án & bối cảnh

### 1.1 Thông tin nhà máy

| Hạng mục | Thông số |
|----------|----------|
| Tổng thiết bị máy móc | 1,000+ các loại |
| Máy CNC (Tiện, Phay) | ~150 máy |
| Tổng nhân công | 2,000+ người |
| Vị trí | Nhật Bản |
| Đặc thù bảo mật | Không cho phép sử dụng điện thoại cá nhân trong nhà máy |

### 1.2 Các bên tham gia

| Đơn vị | Vai trò | Phạm vi |
|--------|---------|---------|
| **DanaExperts** | ERP Partner | Odoo ERP, Custom Web/Mobile App |
| **Y-Nettech** | IoT/Automation Partner | Thu thập data máy móc, kết nối PLC/SCADA, thiết bị IoT |
| **Nhà máy (khách hàng)** | End user | Sản xuất, vận hành, ra quyết định |

### 1.3 Giai đoạn hiện tại

Dự án đang ở **giai đoạn pre-sales**: khách hàng đã hiểu và hài lòng với đề xuất tổng thể, giờ cần DanaExperts làm rõ một số điểm cụ thể trước khi đầu tư. Khách hàng muốn đầu tư trọn gói theo từng phase cho toàn nhà máy, nhưng cần thấy **"the key"** — cụ thể là giải pháp nhập liệu report tại shop floor.

---

## 2. Phân tích hiện trạng (As-Is)

### 2.1 Quy trình hiện tại

```
┌─────────────────┐     Paper      ┌──────────────────┐
│ Phòng Sản xuất  │ ────────────→  │ Xưởng sản xuất   │
│ Lập KHSX        │                │ Công nhân vận    │
│ (生産計画)       │                │ hành máy         │
└─────────────────┘                └──────────────────┘
                                           │
                                           │ Cuối ngày: viết Report
                                           │ bằng Paper (手書き)
                                           ▼
                                   ┌──────────────────┐
                                   │ Phòng QL Sản xuất│
                                   │ Nhập liệu vào   │
                                   │ Excel            │
                                   └──────────────────┘
                                           │
                                    Tổng hợp & kiểm tra
                                    tiến độ
                                           │
                                   ┌───────┴───────┐
                                   ▼               ▼
                              ┌────────┐     ┌──────────┐
                              │  OK    │     │  NOT OK  │
                              │ Kết thúc│    │ Tạo KHSX │
                              └────────┘    │ bù       │
                                             └──────────┘
                                                  │
                                                  ▼
                                           Lặp lại quy trình
```

### 2.2 Pain Points hiện tại

| # | Vấn đề | Tác động | Mức độ |
|---|--------|----------|--------|
| 1 | **Kế hoạch gửi bằng giấy** (Paper) | Dễ thất lạc, không cập nhật realtime, sai sót khi truyền đạt | Cao |
| 2 | **Report cuối ngày bằng giấy** | Tốn thời gian, dễ sai, khó tổng hợp, mất dữ liệu | Rất cao |
| 3 | **Nhập liệu thủ công vào Excel** | Tốn nhân lực, sai số khi nhập lại, chậm trễ | Rất cao |
| 4 | **Kiểm tra tiến độ thủ công** | Không realtime, phát hiện trễ → tạo KHSX bù muộn | Cao |
| 5 | **Không có OEE tracking** | Không biết hiệu suất thực sự của thiết bị | Trung bình |
| 6 | **2,000+ nhân công × Paper** | Lượng giấy tờ khổng lồ, lưu trữ khó, truy xuất chậm | Cao |

### 2.3 Đặc thù vận hành

- Một công nhân có thể chạy **nhiều mã hàng khác nhau** trong một ngày, trên **nhiều đơn hàng** khác nhau.
- Report cuối ngày cần phản ánh: từng mã hàng đã làm bao nhiêu, lỗi gì, lý do gì.
- Phòng QL sản xuất phải tổng hợp từ **hàng trăm tờ paper** mỗi ngày → nhập Excel → so sánh với KHSX.

---

## 3. Yêu cầu từ khách hàng

### 3.1 Các câu hỏi cần giải đáp

| # | Câu hỏi | Mục đích |
|---|---------|----------|
| Q1 | Cách nhập liệu như thế nào để công nhân thao tác **nhanh**? Nếu nhập sai (số lượng, thông tin bản vẽ không đúng KHSX) thì **báo nhập lại**? | Đảm bảo data chính xác |
| Q2 | Nhập liệu dùng **thiết bị nào**? Bố trí như thế nào cho tối ưu? Giải pháp **đầu tư một lần, mở rộng được**, không phải mua thêm bản quyền? | Tối ưu chi phí thiết bị |
| Q3 | Tính **chỉ số OEE** cần yêu cầu gì? Bắt đầu từ **quy trình nào** (mua hàng → xuất hàng)? | Hiểu scope OEE |
| Q4 | **Chi phí triển khai** khoảng bao nhiêu? (Odoo + Custom App Mobile + IoT) | Quyết định đầu tư |
| Q5 | Quay **Video Demo** về cách nhập Report cho người vận hành? | Thuyết phục stakeholders |

### 3.2 Kết luận từ meeting

- Khách hàng **muốn đầu tư trọn gói** nhưng cần thấy được giải pháp cụ thể cho phần nhập liệu report.
- Phase đầu tiên: **tập trung vào flow nhập liệu report cuối ngày** → gửi lên hệ thống → review/approve.
- Kế hoạch sản xuất vẫn gửi bằng **paper** trong phase đầu (giảm rủi ro, không thay đổi quá nhiều cùng lúc).
- Cần một **web app demo** + **video demo** để khách hàng trải nghiệm và đánh giá.

---

## 4. Phân tích nghiệp vụ (BA Analysis)

### 4.1 Scope Demo — Phase 1

Chỉ tập trung vào **một luồng nghiệp vụ chính**:

```
Công nhân nhập Report cuối ngày
        ↓
Tổ trưởng Review / Approve / Reject
        ↓
Trưởng bộ phận Review (nếu cần, tùy mức độ lỗi)
        ↓
QA/QC Review & Approve
        ↓
Giám đốc nhà máy Review (nếu cần, tùy mức độ nghiêm trọng)
        ↓
Data tổng hợp → Dashboard → Báo cáo
```

### 4.2 Timing nghiệp vụ trong ngày

| Thời điểm | Ai | Làm gì |
|-----------|-----|--------|
| **Trong ca làm việc** | Công nhân | Vận hành máy theo KHSX (nhận bằng paper) |
| **Cuối ca / Cuối ngày** (~16:30-17:30) | Công nhân | Nhập report sản xuất qua tablet (lần lượt trong nhóm) |
| **Cuối ngày / Đầu ngày hôm sau** (~17:30-09:00) | Tổ trưởng | Review report của nhóm, approve/reject, bổ sung nhận xét |
| **Trong giờ hành chính ngày hôm sau** | Trưởng bộ phận | Review report có vấn đề, approve/reject |
| **Trong giờ hành chính** | QA/QC | Review chất lượng, approve report lỗi |
| **Khi có escalation** | Giám đốc NM | Approve các vấn đề nghiêm trọng (Critical) |

### 4.3 Đặc thù nhập liệu

- Mỗi công nhân có thể làm **nhiều mã hàng/đơn hàng** trong 1 ngày → report có **nhiều dòng** (line items).
- Form cần **pre-load data từ KHSX**: tên sản phẩm, số lượng kế hoạch, đơn hàng → công nhân chỉ **chỉnh sửa số liệu thực tế** (cộng/trừ).
- Validate: nếu số lượng nhập không khớp logic với KHSX → cảnh báo → yêu cầu nhập lại hoặc giải thích.
- Tablet dùng **chung theo nhóm** (1 tablet / 5 người) → cần đăng nhập bằng user/password cho từng người.

---

## 5. Thiết kế hệ thống Roles & Permissions

### 5.1 Danh sách Roles

| # | Role | 日本語 | Mô tả |
|---|------|--------|-------|
| 1 | **Operator** (Công nhân) | オペレーター / 作業者 | Người vận hành máy, nhập report hàng ngày |
| 2 | **Team Leader** (Tổ trưởng) | 班長 / チームリーダー | Quản lý nhóm 5-10 công nhân, review report |
| 3 | **Section Manager** (Trưởng bộ phận) | 課長 / セクションマネージャー | Quản lý nhiều nhóm, approve/escalate |
| 4 | **QA/QC Inspector** (Nhân viên QA) | 品質管理担当 | Kiểm tra chất lượng, approve report lỗi |
| 5 | **Maintenance Lead** (Trưởng đội bảo trì) | 保全リーダー | Xử lý vấn đề thiết bị, review downtime |
| 6 | **Factory Director** (Giám đốc nhà máy) | 工場長 | Phê duyệt cấp cao nhất, xem dashboard tổng thể |

### 5.2 Ma trận phân quyền

| Quyền | Operator | Team Leader | Section Mgr | QA/QC | Maint. Lead | Director |
|-------|----------|-------------|-------------|-------|-------------|----------|
| **Tạo report mới** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Chỉnh sửa report của mình** | ✅ (khi Draft/Rejected) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Submit report** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Xem report nhóm mình** | Chỉ của mình | ✅ toàn nhóm | ✅ toàn bộ phận | ✅ toàn NM | ✅ (liên quan thiết bị) | ✅ toàn NM |
| **Review & Comment** | ❌ | ✅ | ✅ | ✅ | ✅ (phần thiết bị) | ✅ |
| **Edit record lỗi** | ❌ | ✅ (thêm nguyên nhân, giải pháp) | ❌ | ✅ (cập nhật phân loại lỗi) | ❌ | ❌ |
| **Approve / Reject** | ❌ | ✅ (Level 1) | ✅ (Level 2) | ✅ (Quality Sign-off) | ❌ | ✅ (Level 3) |
| **Xem Dashboard** | Cá nhân | Nhóm | Bộ phận | Chất lượng NM | Thiết bị NM | Tổng thể NM |
| **Export báo cáo** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

### 5.3 Quy tắc đặc biệt (BA Notes)

- **Team Leader có thể edit record lỗi**: Bắt buộc điền nguyên nhân (原因) và hướng giải quyết (対策) — không được để trống. Mục đích: bổ sung thông tin mà công nhân không đủ kinh nghiệm phân tích.
- **Team Leader thay thế**: Team Leader có thể review cho nhóm khác cùng bộ phận (khi Team Leader chính vắng mặt). Section Manager assign quyền này.
- **QA/QC có thể edit phân loại lỗi**: QA có chuyên môn phân loại chính xác hơn công nhân/tổ trưởng. QA có thể thay đổi loại lỗi, severity, root cause category.
- **Section Manager và Director**: Chỉ approve/reject + comment, **không edit** record lỗi (để giữ tính trách nhiệm rõ ràng).
- **Escalation tự động**: Lỗi Critical → bắt buộc escalate đến Director. Lỗi Major → bắt buộc QA review. Lỗi Minor → Team Leader approve là đủ.

---

## 6. Thiết kế Workflow

### 6.1 Workflow States (Trạng thái)

| # | Status | 日本語 | Màu | Mô tả |
|---|--------|--------|-----|-------|
| 1 | `DRAFT` | 下書き | ⚪ Xám | Công nhân đang nhập, chưa hoàn thành |
| 2 | `SAVED` | 一時保存 | 🔵 Xanh dương nhạt | Đã lưu tạm, chưa submit |
| 3 | `SUBMITTED` | 提出済み | 🔵 Xanh dương | Công nhân đã submit, chờ Team Leader |
| 4 | `TL_REVIEWING` | 班長確認中 | 🟡 Vàng | Team Leader đang review |
| 5 | `TL_APPROVED` | 班長承認済 | 🟢 Xanh lá nhạt | Team Leader đã approve |
| 6 | `SM_REVIEWING` | 課長確認中 | 🟠 Cam | Section Manager đang review (nếu cần) |
| 7 | `SM_APPROVED` | 課長承認済 | 🟢 Xanh lá | Section Manager đã approve |
| 8 | `QA_REVIEWING` | QA確認中 | 🟣 Tím | QA đang review |
| 9 | `QA_APPROVED` | QA承認済 | ✅ Xanh đậm | QA đã approve — **Final** |
| 10 | `DIR_REVIEWING` | 工場長確認中 | 🔴 Đỏ nhạt | Director đang review (chỉ khi Critical) |
| 11 | `DIR_APPROVED` | 工場長承認済 | ✅ Xanh đậm | Director đã approve — **Final** |
| 12 | `REJECTED` | 差戻し | 🔴 Đỏ | Bị từ chối, cần chỉnh sửa và submit lại |

### 6.2 Flow Diagram

```
                    ┌──────────┐
                    │  DRAFT   │  Công nhân tạo/nhập
                    │  下書き   │
                    └────┬─────┘
                         │ Save
                         ▼
                    ┌──────────┐
                    │  SAVED   │  Lưu tạm (có thể tiếp tục sau)
                    │ 一時保存  │
                    └────┬─────┘
                         │ Submit
                         ▼
                    ┌──────────────┐
                    │  SUBMITTED   │  Chờ Team Leader
                    │   提出済み    │
                    └──────┬───────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
             ┌────────────┐  ┌──────────┐
             │TL_REVIEWING│  │ REJECTED │ ←── (bất kỳ cấp nào reject)
             │ 班長確認中  │  │  差戻し   │
             └─────┬──────┘  └────┬─────┘
                   │              │ Công nhân sửa → re-submit
                   │ Approve      └───→ quay lại DRAFT
                   ▼
             ┌────────────┐
             │TL_APPROVED │
             │ 班長承認済  │
             └─────┬──────┘
                   │
          ┌────────┴────────┐
          │                 │
    Lỗi Minor         Lỗi Major/Critical
          │                 │
          ▼                 ▼
    ┌────────────┐   ┌──────────────┐
    │QA_REVIEWING│   │SM_REVIEWING  │ (hoặc bỏ qua nếu không cần)
    │ QA確認中   │   │ 課長確認中    │
    └─────┬──────┘   └──────┬───────┘
          │                 │ Approve
          │                 ▼
          │          ┌────────────┐
          │          │SM_APPROVED │
          │          │ 課長承認済  │
          │          └──────┬─────┘
          │                 │
          │      ┌──────────┴──────────┐
          │      │                     │
          │  Lỗi Major            Lỗi Critical
          │      │                     │
          │      ▼                     ▼
          │ ┌────────────┐     ┌───────────────┐
          │ │QA_REVIEWING│     │DIR_REVIEWING  │
          │ │ QA確認中   │     │ 工場長確認中   │
          │ └─────┬──────┘     └───────┬───────┘
          │       │                    │ Approve
          │       │                    ▼
          │       │             ┌──────────────┐
          │       │             │DIR_APPROVED  │
          │       │             │ 工場長承認済  │
          │       │             └──────────────┘
          │       │
          ▼       ▼
    ┌────────────────┐
    │  QA_APPROVED   │  ← Final State (cho Minor/Major)
    │   QA承認済     │
    └────────────────┘
```

### 6.3 Quy tắc Escalation tự động

| Mức độ lỗi | Routing | Lý do |
|-------------|---------|-------|
| **Minor** (軽微) | Operator → Team Leader → QA → Done | Lỗi nhỏ, cosmetic, không ảnh hưởng chức năng |
| **Major** (重大) | Operator → Team Leader → Section Manager → QA → Done | Lỗi ảnh hưởng chất lượng, cần điều tra nguyên nhân |
| **Critical** (致命的) | Operator → Team Leader → Section Manager → QA → Director → Done | Lỗi an toàn, ảnh hưởng khách hàng, cần quyết định cấp cao |

### 6.4 Khi bị Reject

- Report quay về trạng thái **DRAFT** cho công nhân.
- Comment từ người reject bắt buộc phải có (lý do reject).
- Công nhân chỉnh sửa theo comment → submit lại → workflow chạy lại từ đầu.
- Lịch sử reject/re-submit được lưu trữ đầy đủ (audit trail).

---

## 7. Thiết kế Form Report chi tiết

### 7.1 Header — Thông tin chung

| Field | Loại input | Bắt buộc | Ghi chú |
|-------|-----------|----------|---------|
| Ngày report (報告日) | Date picker | ✅ | Default = hôm nay, cho phép chọn ngày quá khứ (tối đa 3 ngày) |
| Ca làm việc (シフト) | Dropdown | ✅ | Ngày (日勤) / Đêm (夜勤) |
| Công nhân (作業者) | Auto-fill | ✅ | Tự điền từ account đăng nhập |
| Máy vận hành (設備) | Dropdown / Scan | ✅ | Chọn từ danh sách máy hoặc scan QR code trên máy |

### 7.2 Body — Line Items (từng mã hàng đã làm trong ngày)

Mỗi dòng (line) là một **mã hàng/sản phẩm** mà công nhân đã làm trong ngày:

| Field | Loại input | Bắt buộc | Ghi chú |
|-------|-----------|----------|---------|
| Lô hàng (ロット) | Dropdown (searchable) | ✅ | Pre-load từ KHSX, filter theo máy |
| Sản phẩm / Mã hàng (製品コード) | Dropdown (searchable) | ✅ | Auto-filter khi chọn lô hàng |
| Số lượng kế hoạch (計画数) | Display only | — | Tự hiển thị từ KHSX, không cho sửa |
| Số lượng đã làm (実績数) | Number input (+/- buttons) | ✅ | Buttons +1, -1 để chỉnh nhanh. Validate: cảnh báo nếu > 120% kế hoạch |
| Tổng giờ làm (作業時間) | Number input (giờ:phút) | ✅ | Tự động suggest dựa trên ca làm việc |
| Số sản phẩm lỗi (不良数) | Number input | ✅ | Validate: không lớn hơn số lượng đã làm |
| **Chi tiết lỗi** (不良詳細) | Sub-table (xem 7.3) | ✅ nếu có lỗi | Bắt buộc khi số lỗi > 0 |

**Validation rules:**
- Nếu số lượng thực > 120% kế hoạch → cảnh báo vàng, yêu cầu xác nhận.
- Nếu số lỗi > 10% số lượng thực → cảnh báo đỏ, yêu cầu giải thích.
- Nếu thông tin không khớp KHSX (sản phẩm, mã hàng) → báo lỗi, không cho submit.

### 7.3 Sub-table — Chi tiết từng sản phẩm lỗi

Mỗi dòng lỗi (defect line):

| Field | Loại input | Bắt buộc (Operator) | Bắt buộc (Team Leader) | Ghi chú |
|-------|-----------|---------------------|----------------------|---------|
| Loại lỗi (不良種類) | Dropdown + multi-select | ✅ | ✅ | Xem danh mục Section 8 |
| Mức độ (重要度) | Radio buttons | ✅ | ✅ | Minor / Major / Critical |
| Số lượng lỗi loại này | Number | ✅ | ✅ | |
| Mô tả lỗi (不良内容) | Text input | Tùy chọn | ✅ | Free text mô tả chi tiết |
| Nguyên nhân (原因) | Dropdown (4M) + text | **Tùy chọn** | **Bắt buộc** | Xem danh mục Section 8 |
| Hướng giải quyết (対策) | Dropdown + text | **Tùy chọn** | **Bắt buộc** | Xem danh mục Section 8 |
| Ảnh đính kèm (写真) | Camera / Upload | Tùy chọn | Tùy chọn | Chụp trực tiếp từ tablet |

**BA Notes quan trọng:**
- Operator được phép để trống nguyên nhân và hướng giải quyết → giảm thời gian nhập liệu cuối ngày.
- Team Leader **bắt buộc** điền nguyên nhân và giải pháp khi review → đảm bảo chất lượng phân tích.
- QA có thể **edit lại** phân loại lỗi, mức độ, nguyên nhân → đảm bảo tính chính xác.

### 7.4 Footer — Thông tin bổ sung

| Field | Loại input | Bắt buộc | Ghi chú |
|-------|-----------|----------|---------|
| Ghi chú bổ sung (備考) | Text area | Tùy chọn | Công nhân nhập nếu cần (giải thích trễ tiến độ, vấn đề đặc biệt) |
| Comment từ cấp trên (コメント) | Text area | Tùy chọn | Mỗi level khi review có thể thêm comment |
| **Nút Submit** (提出) | Button | — | Chỉ hiện cho Operator/Team Leader |
| **Nút Approve** (承認) | Button | — | Chỉ hiện cho cấp có quyền approve |
| **Nút Reject** (差戻し) | Button | — | Chỉ hiện cho cấp có quyền reject, bắt buộc nhập lý do |

### 7.5 Feature tương lai (Phase 2+)

- **Voice-to-text**: Nhập ghi chú bằng giọng nói → chuyển thành text tự động. Hỗ trợ tiếng Nhật.
- **Barcode/QR scan**: Scan mã trên sản phẩm/lô hàng để tự động fill.
- **Ảnh AI analysis**: Chụp ảnh lỗi → AI phân loại lỗi sơ bộ.

---

## 8. Danh mục lỗi, nguyên nhân, giải pháp (Master Data)

### 8.1 Loại lỗi cho gia công CNC (不良種類)

Dữ liệu pre-loaded dạng **dropdown có search**:

| Mã | Loại lỗi (JP) | Loại lỗi (VN) | Áp dụng cho |
|----|---------------|---------------|-------------|
| D01 | 寸法不良 | Sai kích thước / Không đạt dung sai | Tiện, Phay |
| D02 | 面粗度不良 | Độ nhám bề mặt không đạt | Tiện, Phay |
| D03 | バリ発生 | Phát sinh ba-via (burr) | Tiện, Phay |
| D04 | チャタリング | Rung chatter marks | Phay |
| D05 | 割れ・欠け | Nứt / Sứt mẻ | Tiện, Phay |
| D06 | キズ | Trầy xước bề mặt | Tiện, Phay |
| D07 | 変形・歪み | Biến dạng / Cong vênh | Tiện, Phay |
| D08 | 穴位置ズレ | Lệch vị trí lỗ khoan | Phay |
| D09 | ネジ不良 | Lỗi ren (ren không đạt) | Tiện |
| D10 | 刃物摩耗痕 | Vết mài mòn dao cắt | Tiện, Phay |
| D11 | 材料不良 | Lỗi nguyên vật liệu | Chung |
| D12 | プログラムミス | Lỗi chương trình CNC | Chung |
| D99 | その他 | Khác (nhập tay) | Chung |

### 8.2 Nguyên nhân theo 4M (原因分類)

Dạng **dropdown theo nhóm (grouped dropdown)**:

**Man (人 - Con người)**
| Mã | Nguyên nhân (JP) | Nguyên nhân (VN) |
|----|-----------------|-----------------|
| M1-01 | 操作ミス | Lỗi thao tác |
| M1-02 | 確認不足 | Kiểm tra không kỹ |
| M1-03 | 経験不足 | Thiếu kinh nghiệm |
| M1-04 | 教育不足 | Thiếu đào tạo |
| M1-05 | 注意力散漫 | Mất tập trung |
| M1-06 | 引継ぎ不足 | Bàn giao không đầy đủ |

**Machine (機械 - Máy móc)**
| Mã | Nguyên nhân (JP) | Nguyên nhân (VN) |
|----|-----------------|-----------------|
| M2-01 | 設備故障 | Hỏng thiết bị |
| M2-02 | 刃物摩耗 | Mòn dao cắt |
| M2-03 | 精度低下 | Giảm độ chính xác |
| M2-04 | メンテナンス不足 | Bảo trì không đầy đủ |
| M2-05 | 設備の老朽化 | Thiết bị cũ/lão hóa |
| M2-06 | 冷却液不足 | Thiếu dung dịch làm mát |

**Material (材料 - Nguyên vật liệu)**
| Mã | Nguyên nhân (JP) | Nguyên nhân (VN) |
|----|-----------------|-----------------|
| M3-01 | 材料不良 | NVL kém chất lượng |
| M3-02 | 材料間違い | Dùng nhầm NVL |
| M3-03 | 保管不良 | Bảo quản NVL sai cách |
| M3-04 | ロット差異 | Khác biệt giữa các lô NVL |

**Method (方法 - Phương pháp)**
| Mã | Nguyên nhân (JP) | Nguyên nhân (VN) |
|----|-----------------|-----------------|
| M4-01 | 加工条件不適 | Thông số gia công không phù hợp |
| M4-02 | プログラム誤り | Lỗi chương trình |
| M4-03 | 手順書不備 | Hướng dẫn công việc không đầy đủ |
| M4-04 | 治具不良 | Jig/fixture không đạt |
| M4-05 | 測定方法誤り | Phương pháp đo sai |
| M4-06 | 段取り不良 | Setup/changeover sai |

### 8.3 Hướng giải quyết (対策)

Dạng **dropdown + text bổ sung**:

| Mã | Giải pháp (JP) | Giải pháp (VN) | Loại |
|----|---------------|---------------|------|
| A01 | 再加工 | Gia công lại (rework) | Tức thời |
| A02 | 刃物交換 | Thay dao cắt | Tức thời |
| A03 | 設備調整 | Hiệu chỉnh thiết bị | Tức thời |
| A04 | 加工条件変更 | Thay đổi thông số gia công | Tức thời |
| A05 | 材料交換 | Đổi nguyên vật liệu | Tức thời |
| A06 | 再教育実施 | Đào tạo lại | Phòng ngừa |
| A07 | 手順書改訂 | Cập nhật hướng dẫn công việc | Phòng ngừa |
| A08 | 設備修理依頼 | Yêu cầu sửa chữa thiết bị | Phòng ngừa |
| A09 | 治具改善 | Cải thiện jig/fixture | Phòng ngừa |
| A10 | ポカヨケ導入 | Áp dụng Poka-yoke | Phòng ngừa |
| A11 | 定期点検追加 | Bổ sung kiểm tra định kỳ | Phòng ngừa |
| A12 | 廃棄処分 | Hủy bỏ (scrap) | Xử lý |
| A99 | その他 | Khác (nhập tay) | — |

---

## 9. Dashboard theo Role

### 9.1 Operator Dashboard (作業者ダッシュボード)

**Nội dung**: Thông tin cá nhân, đơn giản, trực quan.

| Khu vực | Nội dung | Visual |
|---------|----------|--------|
| Header | Xin chào {Tên}, ca {ngày/đêm}, ngày {date} | Text lớn |
| KPI Cards | Số lượng đã làm hôm nay / Tỷ lệ hoàn thành | 2 cards lớn |
| Danh sách report | Report gần nhất của mình + trạng thái | Table đơn giản |
| Thông báo | Report bị reject (nếu có) | Alert badge |

### 9.2 Team Leader Dashboard (班長ダッシュボード)

**Nội dung**: Tổng hợp nhóm + report chờ review.

| Khu vực | Nội dung | Visual |
|---------|----------|--------|
| KPI Cards | Tổng sản lượng nhóm / Tỷ lệ lỗi nhóm / Report chờ review | 3-4 cards |
| Pending Reviews | Danh sách report chờ approve (sorted by priority) | Table với action buttons |
| Nhân viên hôm nay | Ai đã submit / chưa submit | Status list |
| Chart | So sánh kế hoạch vs thực tế của nhóm (bar chart) | Bar chart |

### 9.3 Section Manager Dashboard (課長ダッシュボード)

**Nội dung**: Tổng hợp bộ phận + pending approvals + trends.

| Khu vực | Nội dung | Visual |
|---------|----------|--------|
| KPI Cards | Tổng sản lượng bộ phận / Tỷ lệ lỗi / Tỷ lệ đúng tiến độ / Report pending | 4 cards |
| Pending Approvals | Report chờ approve Level 2 | Table |
| Sản lượng theo ngày/tuần/tháng | Trend chart | Line chart |
| Tổng hợp theo đơn hàng | Tiến độ từng đơn hàng | Progress bars |
| Tổng hợp lỗi | Top 5 loại lỗi trong tuần/tháng | Pareto chart |

### 9.4 QA/QC Dashboard (品質管理ダッシュボード)

**Nội dung**: Chất lượng toàn nhà máy.

| Khu vực | Nội dung | Visual |
|---------|----------|--------|
| KPI Cards | Tỷ lệ lỗi NM / Open alerts / First Pass Yield | 3-4 cards |
| Pending QA Reviews | Report lỗi chờ QA approve | Table |
| Defect Pareto | Top lỗi theo loại (tuần/tháng) | Pareto chart |
| Defect Trend | Xu hướng lỗi theo ngày | Line chart |
| Phân tích 4M | Tỷ lệ nguyên nhân theo 4M | Pie chart |
| Tổng hợp lỗi theo sản phẩm | Heatmap product × defect type | Heatmap |

### 9.5 Factory Director Dashboard (工場長ダッシュボード)

**Nội dung**: KPIs chiến lược, overview toàn nhà máy.

| Khu vực | Nội dung | Visual |
|---------|----------|--------|
| KPI Cards | OEE / Tổng sản lượng / Tỷ lệ lỗi / Tỷ lệ đúng tiến độ / Chi phí | 5 cards với trend arrows |
| Sản lượng tổng hợp | Theo ngày/tuần/tháng, so sánh với kế hoạch | Area chart |
| Tổng giờ làm | Tổng hợp giờ làm theo bộ phận | Stacked bar |
| Tổng hợp đơn hàng | Tiến độ overall, đơn hàng trễ | Table + progress |
| Alert Summary | Lỗi Critical chưa giải quyết | Alert cards |
| Department Performance | So sánh hiệu suất các bộ phận | Radar chart |

### 9.6 Maintenance Lead Dashboard (保全リーダー)

| Khu vực | Nội dung | Visual |
|---------|----------|--------|
| KPI Cards | Thiết bị đang lỗi / MTBF / MTTR | 3 cards |
| Downtime reports | Từ report sản xuất, liên quan thiết bị | Table |
| Equipment status | Trạng thái máy theo line | Status grid |

---

## 10. Giải pháp thiết bị nhập liệu

### 10.1 So sánh các phương án

| Phương án | Chi phí | Ưu điểm | Nhược điểm | Đề xuất |
|-----------|---------|---------|------------|---------|
| **A. Điện thoại cá nhân** | Rất thấp | Không cần mua thiết bị | Bảo mật NM không cho phép dùng ĐT | ❌ Không khả thi |
| **B. Tablet theo nhóm** | Trung bình | Linh hoạt, di chuyển dễ, mở rộng nhanh | Cần quản lý thiết bị, chờ đợi khi nhập | ✅ **Đề xuất chính** |
| **C. Màn hình HMI** | Cao | Cố định, tích hợp IoT trực tiếp | Khó mở rộng, tốn chi phí tủ điện, cố định vị trí | ⚠️ Không khuyến khích (đã có bài học thực tế) |
| **D. IoT device + màn hình** | Cao | Collect data tự động + nhập liệu | Phức tạp, chi phí ban đầu lớn | 🔜 Phase 2 |

### 10.2 Phương án đề xuất: Tablet theo nhóm

**Tỷ lệ**: 1 tablet / 5 công nhân (1 nhóm/Team Leader)

**Ước tính cho nhà máy 2,000 người:**
- Số nhóm: ~400 nhóm
- Số tablet cần: ~400 tablets + 10% dự phòng = **~440 tablets**
- Chi phí thiết bị: ~440 × $300-500 (tablet tầm trung) = **$132,000 - $220,000**

**Quy trình nhập liệu:**
1. Cuối ca, Team Leader phát tablet cho nhóm
2. Từng công nhân login bằng user/password → nhập report → submit → logout
3. Team Leader login → review tất cả report nhóm → approve/reject
4. Tablet kết nối WiFi nội bộ → data gửi lên server/Odoo

**Hạ tầng cần thiết:**
- WiFi coverage toàn nhà máy (nội bộ, không cần internet)
- Server nội bộ hoặc cloud (tùy chính sách bảo mật)
- Tủ sạc tablet tập trung

**Authentication:**
- Phase 1: User/Password cho từng công nhân
- Phase 2: Vân tay hoặc Face ID (nếu tablet hỗ trợ)

### 10.3 Phần mềm — Custom Web App

Phát triển **Custom Web App** (Progressive Web App - PWA), không phải native app:

| Ưu điểm | Chi tiết |
|---------|---------|
| Không cần cài app | Mở browser → truy cập URL → dùng ngay |
| Không phụ thuộc OS | Chạy trên Android tablet, iPad, laptop đều được |
| Không mua bản quyền per-device | 1 lần phát triển, dùng cho bao nhiêu thiết bị cũng được |
| Cập nhật tức thì | Update server → tất cả thiết bị có version mới ngay |
| Offline mode (PWA) | Có thể nhập offline → sync khi có WiFi |

Data từ Web App → gửi lên **Odoo qua API** (JSON-RPC / REST).

---

## 11. OEE — Yêu cầu & Quy trình tính

### 11.1 Công thức OEE

```
OEE = Availability × Performance × Quality

Availability (可動率) = Run Time / Planned Production Time
Performance (性能稼働率) = (Ideal Cycle Time × Total Count) / Run Time
Quality (良品率) = Good Count / Total Count
```

### 11.2 Dữ liệu cần thu thập

| Thành phần | Dữ liệu cần | Nguồn thu thập |
|-----------|-------------|----------------|
| **Availability** | Thời gian máy chạy, thời gian dừng (planned/unplanned), lý do dừng | IoT sensors (Y-Nettech) + Report công nhân |
| **Performance** | Cycle time tiêu chuẩn, cycle time thực tế, tổng số sản phẩm | IoT sensors + KHSX + Report |
| **Quality** | Tổng sản phẩm, số sản phẩm lỗi | Report công nhân + QA data |

### 11.3 Quy trình OEE trong chuỗi sản xuất

```
Mua hàng (購買)        → Nguyên vật liệu chất lượng → ảnh hưởng Quality
     ↓
Nhập kho (入庫)        → Kiểm tra IQC → ảnh hưởng Quality
     ↓
Lập KHSX (生産計画)    → Planned Production Time → cơ sở Availability
     ↓
Sản xuất (製造)        → Run time, downtime, cycle time, output
     ↓                     → ĐÂY LÀ NƠI ĐO OEE CHÍNH
     ↓
Kiểm tra QC (品質検査)  → Good count vs Total count → Quality
     ↓
Xuất kho (出庫)        → On-time delivery (KPI bổ sung)
     ↓
Giao hàng (出荷)       → Customer satisfaction (KPI bổ sung)
```

### 11.4 OEE Benchmark

| Mức | OEE | Ý nghĩa |
|-----|-----|---------|
| World-class | ≥ 85% | Availability ≥90%, Performance ≥95%, Quality ≥99.9% |
| Good | 70-84% | Có cải thiện nhưng còn dư địa |
| Average | 55-69% | Trung bình ngành sản xuất |
| Low | < 55% | Cần cải thiện nghiêm túc |

### 11.5 Vai trò từng bên trong OEE

| Bên | Vai trò OEE |
|-----|------------|
| **DanaExperts (Odoo)** | Thu thập data report từ web app, tổng hợp & tính toán OEE, dashboard, báo cáo |
| **Y-Nettech (IoT)** | Thu thập data tự động từ máy (run time, cycle time, temperature...) → gửi về Odoo |
| **Kết hợp** | IoT data (real-time) + Operator report (cuối ngày) = OEE chính xác |

---

## 12. Ước tính chi phí triển khai

### 12.1 Cấu trúc chi phí

| Hạng mục | Ước tính | Ghi chú |
|----------|---------|---------|
| **Odoo ERP License + Implementation** | ¥30M - ¥50M (~$200K - $330K) | Tùy số module, số user review/approve |
| **Custom Web App (PWA)** | 25-40% của Odoo | Phát triển app nhập liệu, dashboard |
| **IoT System (Y-Nettech)** | Tùy scope | Thu thập data máy CNC, sensors |
| **Thiết bị Tablet** | ¥5M - ¥10M | ~440 tablets × ¥12,000-25,000 |
| **Hạ tầng WiFi + Server** | ¥3M - ¥8M | WiFi AP, server nội bộ |
| **Đào tạo** | Bao gồm | Training cho 2,000+ nhân viên |

### 12.2 Mô hình chi phí user

| Thành phần | Tính phí user? | Ghi chú |
|-----------|---------------|---------|
| **Custom Web App** (nhập liệu) | ❌ **Không tính phí per-user** | DanaExperts tự quản lý, phát triển 1 lần |
| **Odoo** (Review/Approve/Dashboard) | ✅ Tính phí per-user | Chỉ tính cho người dùng Odoo backend (manager, QA, director) |
| **IoT** | ❌ Không tính per-user | Y-Nettech quản lý |

Nghĩa là: 2,000 công nhân nhập liệu qua Web App → **không tốn license Odoo**. Chỉ ~50-100 người dùng Odoo (managers, QA, director) mới tính license.

### 12.3 Phase đề xuất

| Phase | Scope | Timeline | Chi phí ước tính |
|-------|-------|----------|-----------------|
| **Phase 1** | Web App nhập liệu report + Odoo basic (Manufacturing, Inventory) + Dashboard | 3-4 tháng | Cận dưới |
| **Phase 2** | IoT integration + OEE auto-calculation + Maintenance module | 3-4 tháng | Trung bình |
| **Phase 3** | Full ERP (HR, Accounting, PLM) + Advanced analytics + Voice input | 4-6 tháng | Cận trên |

---

## 13. Plan triển khai Demo

### 13.1 Deliverables

| # | Deliverable | Format | Deadline | Phụ trách |
|---|------------|--------|----------|-----------|
| 1 | **Web App Demo** (interactive prototype) | Web App (.html/.jsx) | Thứ Hai tuần sau | DanaExperts |
| 2 | **Video Demo** (kịch bản nhập liệu) | MP4 (quay trên tablet) | Sau khi có web app | DanaExperts + Y-Nettech |
| 3 | **Tài liệu giải pháp chi tiết** | PPTX/PDF | Song song | DanaExperts |

### 13.2 Scope Web App Demo

**Bao gồm:**
- Login screen (chọn role / nhập user+password)
- Operator flow: chọn đơn hàng → chọn sản phẩm → nhập số liệu → report lỗi → submit
- Team Leader flow: xem danh sách report → review → approve/reject → thêm comment
- QA flow: xem report lỗi → review → approve
- Dashboard cho từng role (với mock data)
- Giao diện tiếng Nhật
- Mock data realistic (tên Nhật, sản phẩm CNC, số liệu thực tế)

**Không bao gồm (Phase 1 Demo):**
- Kết nối Odoo thật
- IoT data
- Offline mode
- Voice-to-text
- Barcode/QR scan

### 13.3 Tech Stack cho Demo

| Layer | Công nghệ | Lý do |
|-------|----------|-------|
| Frontend | React (JSX) hoặc HTML + Tailwind CSS | Single file, dễ deploy, dễ demo |
| Charts | Recharts / Chart.js | Dashboard charts |
| Data | Mock data in-memory (JSON) | Không cần backend cho demo |
| i18n | Japanese as default | Khách hàng Nhật |
| Hosting | Static file → mở trên browser | Gửi file cho khách tự mở |

---

## 14. Kịch bản quay Video Demo

### 14.1 Cấu trúc video

| Scene | Nội dung | Thời lượng | Thiết bị |
|-------|----------|-----------|----------|
| **Opening** | Giới thiệu giải pháp Smart Factory Report | 30s | Slide |
| **Scene 1** | Công nhân A login → xem đơn hàng hôm nay | 30s | Tablet |
| **Scene 2** | Công nhân A nhập report: chọn lô, sản phẩm, nhập số liệu (+/- buttons) | 1 phút | Tablet |
| **Scene 3** | Công nhân A report lỗi: chọn loại lỗi, mức độ, mô tả | 1 phút | Tablet |
| **Scene 4** | Công nhân A submit → logout | 15s | Tablet |
| **Scene 5** | Công nhân B login → nhập report (scenario khác) → submit | 1 phút | Tablet |
| **Scene 6** | Team Leader login → xem danh sách report → review → thêm nguyên nhân/giải pháp → approve | 1.5 phút | Tablet/PC |
| **Scene 7** | QA login → xem report lỗi → review → approve | 1 phút | PC |
| **Scene 8** | Manager/Director xem dashboard | 1 phút | PC |
| **Closing** | Tổng kết lợi ích, next steps | 30s | Slide |

**Tổng**: ~8-9 phút

### 14.2 Kịch bản chi tiết — Scene 2 (ví dụ)

**Narrator (tiếng Nhật)**: "田中さんは本日の生産実績を入力します。ロットと製品を選択し、計画数量が自動表示されます。実績数量を+/-ボタンで簡単に調整できます。"

(Tạm dịch: "Anh Tanaka nhập thực tế sản xuất hôm nay. Chọn lô và sản phẩm, số lượng kế hoạch tự động hiển thị. Điều chỉnh số lượng thực tế bằng nút +/- đơn giản.")

**Hành động trên tablet:**
1. Tap chọn lô hàng "LOT-2026-0342" từ dropdown
2. Tap chọn sản phẩm "アルミフレーム A-100"
3. Hiển thị: Kế hoạch = 100, tap nút "-" 2 lần → Thực tế = 98
4. Nhập giờ làm: 7.5h
5. Nhập số lỗi: 2

### 14.3 Talking points cho video

- **Tốc độ nhập liệu**: Data đã có sẵn từ KHSX → chỉ cần chỉnh sửa → tiết kiệm 80% thời gian so với viết paper.
- **Tính chính xác**: Validation tự động → không nhập sai, không nhập thiếu.
- **Truy xuất ngay lập tức**: Manager/QA xem data realtime, không cần chờ nhập Excel.
- **Phân quyền rõ ràng**: Mỗi người chỉ thấy/làm những gì thuộc trách nhiệm.
- **Chi phí hợp lý**: 1 tablet / nhóm, không cần mua license per-user cho công nhân.

---

## 15. Phụ lục

### 15.1 Thuật ngữ

| Tiếng Việt | Tiếng Nhật | English |
|-----------|-----------|---------|
| Kế hoạch sản xuất | 生産計画 (せいさんけいかく) | Production Plan |
| Báo cáo sản xuất hàng ngày | 生産日報 (せいさんにっぽう) | Daily Production Report |
| Công nhân vận hành | 作業者 (さぎょうしゃ) / オペレーター | Operator |
| Tổ trưởng | 班長 (はんちょう) | Team Leader |
| Trưởng bộ phận | 課長 (かちょう) | Section Manager |
| Giám đốc nhà máy | 工場長 (こうじょうちょう) | Factory Director |
| Lô hàng | ロット | Lot |
| Sản phẩm lỗi | 不良品 (ふりょうひん) | Defective Product |
| Nguyên nhân | 原因 (げんいん) | Root Cause |
| Hướng giải quyết | 対策 (たいさく) | Countermeasure |
| Phê duyệt | 承認 (しょうにん) | Approve |
| Từ chối | 差戻し (さしもどし) | Reject / Return |
| Chỉ số hiệu suất thiết bị | 設備総合効率 (OEE) | Overall Equipment Effectiveness |

### 15.2 Tài liệu tham khảo

- OEE.com — OEE Calculation Standards
- Toyota Production System — Jidoka, Poka-yoke, Kaizen
- Odoo Manufacturing Documentation
- Japanese Institute of Plant Maintenance (JIPM) — TPM Framework

### 15.3 Các bước tiếp theo

| # | Action Item | Ai | Deadline |
|---|------------|-----|----------|
| 1 | Xin form report mẫu (dạng chưa điền) từ khách hàng | Y-Nettech | ASAP |
| 2 | Xin các case thực tế (vấn đề trong SX) để làm mock data | Y-Nettech | ASAP |
| 3 | Phát triển Web App Demo | DanaExperts | 1 tuần |
| 4 | Review demo nội bộ | DanaExperts + Y-Nettech | Sau #3 |
| 5 | Quay video demo trên tablet | DanaExperts + Y-Nettech | Sau #4 |
| 6 | Gửi demo + video cho khách hàng | Y-Nettech | Sau #5 |
| 7 | Thu thập feedback từ khách → điều chỉnh | Cả team | Liên tục |
| 8 | Lên báo giá chi tiết theo phase | DanaExperts | Song song |

---

*Tài liệu này được tạo bởi DanaExperts Team, kết hợp phân tích BA, Tech Lead, và UI/UX Design. Cập nhật theo tiến độ dự án.*
