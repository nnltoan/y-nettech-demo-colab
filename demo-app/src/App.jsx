import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import MiddlewarePanel from './MiddlewarePanel';
import workOrderApi from './api/work-order.api';
import { adaptShiftForMiddleware } from './adapter/demo-colab-adapter.js';
import {
  Menu, X, LogOut, Globe, Plus, Download, Edit2, Check, AlertCircle,
  TrendingUp, Users, Clock, AlertTriangle, ChevronDown, ChevronRight,
  Home, FileText, UserCheck, BarChart3, Settings, Lock, Unlock,
  Calendar, Filter, Search, Eye, ArrowRight, ArrowUp, ArrowDown,
  CheckCircle, XCircle, Trash2, Save, Send, Info, Percent, Activity,
  ChevronUp, Copy, Cog, Package, Layers, Database, RefreshCw,
  CircleAlert, FileCheck, FileWarning, Hash, Wrench, Factory,
  ClipboardList, ClipboardCheck, Upload, PlayCircle, PauseCircle,
  ChevronLeft, Zap, Flag, RotateCcw
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';

// ============================================================================
// UTILITY HELPERS
// ============================================================================
const createSeededRandom = (seed) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// Date picker boundaries: operators can only backfill today or the past 3 days.
const daysAgoStr = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const MIN_REPORT_DATE_OFFSET = 3; // max 3 days in the past

const calcMinutes = (start, end) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // handle wrap-around (e.g. 22:00 -> 06:00)
  return Math.max(0, diff);
};

// Convert "HH:MM" string to minute-of-day integer (0..1439)
const timeToMin = (hhmm) => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Default (planned) shift windows; used as soft bounds for validation.
// Shift 3 is a cross-midnight shift → 22:00 today → 06:00 next day.
const SHIFT_WINDOWS = {
  1: { start: '06:00', end: '14:00', crossMidnight: false },
  2: { start: '14:00', end: '22:00', crossMidnight: false },
  3: { start: '22:00', end: '06:00', crossMidnight: true },
};

// Validate a shift's (start, end). For non-cross-midnight shifts the end must
// be strictly after the start. For shift 3 the end is interpreted as "next day"
// so a wrap-around is the normal case. We cap the shift length at 16h (8h shift
// + generous OT buffer) to catch nonsense entries.
const validateShiftTimes = (shiftNumber, start, end) => {
  if (!start || !end) return { valid: false, reason: 'missing' };
  const sMin = timeToMin(start);
  const eMin = timeToMin(end);
  const cross = shiftNumber === 3;
  let diff = eMin - sMin;
  if (diff <= 0) {
    if (cross) diff += 24 * 60; // wrap is expected for night shift
    else return { valid: false, reason: 'endBeforeStart' };
  }
  if (diff < 60) return { valid: false, reason: 'tooShort' };
  if (diff > 16 * 60) return { valid: false, reason: 'tooLong' };
  return { valid: true, reason: '' };
};

// Check whether a given "HH:MM" time falls inside a shift window. For shifts
// that cross midnight (e.g. 22:00 → 06:00), the window is interpreted as a
// continuous range that wraps through 24:00. We treat the shift end as
// INCLUSIVE so that e.g. 14:00 is accepted as the last moment of shift 1.
//   Shift 1 (06:00-14:00): valid times ∈ [06:00, 14:00]
//   Shift 2 (14:00-22:00): valid times ∈ [14:00, 22:00]
//   Shift 3 (22:00-06:00): valid times ∈ [22:00, 24:00) ∪ [00:00, 06:00]
const isTimeWithinShift = (time, shiftStart, shiftEnd) => {
  if (!time || !shiftStart || !shiftEnd) return false;
  const t = timeToMin(time);
  const s = timeToMin(shiftStart);
  const e = timeToMin(shiftEnd);
  if (s === e) return t === s; // degenerate (shouldn't happen)
  if (s < e) return t >= s && t <= e;           // normal same-day window
  return t >= s || t <= e;                       // wrap-around (night shift)
};

// Validate a downtime / overtime sub-interval against its parent shift.
// Returns { valid, reason } where reason is:
//   'missing'       → start or end is blank
//   'startOutside'  → start is outside the shift window
//   'endOutside'    → end is outside the shift window
//   'endBeforeStart'→ end is before start (respecting wrap-around)
//   'tooLong'       → interval longer than 8h (sanity check)
const validateIntervalWithinShift = (intervalStart, intervalEnd, shiftStart, shiftEnd) => {
  if (!intervalStart || !intervalEnd) return { valid: false, reason: 'missing' };
  if (!isTimeWithinShift(intervalStart, shiftStart, shiftEnd)) {
    return { valid: false, reason: 'startOutside' };
  }
  if (!isTimeWithinShift(intervalEnd, shiftStart, shiftEnd)) {
    return { valid: false, reason: 'endOutside' };
  }
  // Compute length of interval, accounting for the shift's own wrap-around.
  // We convert interval times to "shift-relative minutes" where the shift
  // start is 0 and the shift end is positive (= shift length).
  const toRel = (time) => {
    const tMin = timeToMin(time);
    const sMin = timeToMin(shiftStart);
    let rel = tMin - sMin;
    if (rel < 0) rel += 24 * 60; // wrap through midnight
    return rel;
  };
  const relStart = toRel(intervalStart);
  const relEnd = toRel(intervalEnd);
  if (relEnd < relStart) return { valid: false, reason: 'endBeforeStart' };
  if (relEnd - relStart > 8 * 60) return { valid: false, reason: 'tooLong' };
  return { valid: true, reason: '' };
};

const addMinutes = (time, delta) => {
  if (!time) return time;
  const [h, m] = time.split(':').map(Number);
  let total = (h * 60 + m + delta) % (24 * 60);
  if (total < 0) total += 24 * 60;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
};

const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

const sumNG = (p) => {
  const defectNG = (p.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
  return (p.ngTest || 0) + (defectNG || p.ng || 0) + (p.ngPending || 0);
};

// ============================================================================
// MASTER DATA: MACHINES — fallback mock (override bởi main.jsx khi có middleware)
// ============================================================================
// ⚠ 'let' thay vì 'const' để main.jsx có thể replace bằng data từ middleware trước khi render
let machines = [
  { id: 'TIEN01', name: 'TIỆN CNC 01',       line: 'Line Tiện',     dept: 'Gia công CNC', shift1Cap: 180, shift2Cap: 185, shift3Cap: 190, rate: 0.75 },
  { id: 'PHAY01', name: 'PHAY CNC 01',       line: 'Line Phay',     dept: 'Gia công CNC', shift1Cap: 175, shift2Cap: 180, shift3Cap: 185, rate: 0.75 },
  { id: 'PHAY02', name: 'PHAY CNC 02',       line: 'Line Phay',     dept: 'Gia công CNC', shift1Cap: 170, shift2Cap: 175, shift3Cap: 180, rate: 0.75 },
  { id: 'OTHER',  name: 'CÁC LOẠI MÁY KHÁC', line: 'Line Tổng hợp', dept: 'Gia công CNC', shift1Cap: 200, shift2Cap: 200, shift3Cap: 200, rate: 0.70 },
];

// ============================================================================
// MASTER DATA: PRODUCTS — 3 sản phẩm FCC theo CNC_Flow.pdf
// ============================================================================
// Immutable original products — dùng làm fallback khi middleware override `products`
const ORIGINAL_PRODUCTS = [
  { code: 'SP-A', name_vi: 'Sản Phẩm A', name_ja: '製品A', keyIFS: 'IFS-CSCO-001', docCode: 'DC-F001', ct: 2.5, dailyTarget: 1000 },
  { code: 'SP-B', name_vi: 'Sản Phẩm B', name_ja: '製品B', keyIFS: 'IFS-CSCO-002', docCode: 'DC-F002', ct: 3.2, dailyTarget: 2000 },
  { code: 'SP-C', name_vi: 'Sản Phẩm C', name_ja: '製品C', keyIFS: 'IFS-CSCO-003', docCode: 'DC-F003', ct: 2.8, dailyTarget: 500 },
];
let products = [...ORIGINAL_PRODUCTS];

// Lookup product with fallback to originals (khi middleware override products với codes khác)
const findProductByCode = (code) => products.find(p => p.code === code) || ORIGINAL_PRODUCTS.find(p => p.code === code);

// ============================================================================
// ROUTING: Product × Operation × Machine mapping (from CNC_Flow.pdf)
// Mỗi entry = 1 công đoạn trên 1 máy. dailyQty = tổng/ngày cho công đoạn đó.
// ============================================================================
const ROUTING = [
  // Sản Phẩm A — 4 công đoạn
  { productCode: 'SP-A', operation: 'Tiện thô',      operationJa: '粗旋削',   machineId: 'TIEN01', step: 1, dailyQty: 1000 },
  { productCode: 'SP-A', operation: 'Phay thô',      operationJa: '粗フライス', machineId: 'PHAY01', step: 2, dailyQty: 1000 },
  { productCode: 'SP-A', operation: 'Tiện tinh',     operationJa: '仕上旋削',  machineId: 'TIEN01', step: 3, dailyQty: 1000 },
  { productCode: 'SP-A', operation: 'Phay tinh',     operationJa: '仕上フライス', machineId: 'PHAY02', step: 4, dailyQty: 1000 },
  // Sản Phẩm B — 3 công đoạn
  { productCode: 'SP-B', operation: 'Phay tạo phôi', operationJa: 'ブランクフライス', machineId: 'PHAY01', step: 1, dailyQty: 2000 },
  { productCode: 'SP-B', operation: 'Phay bán tinh', operationJa: '中仕上フライス', machineId: 'PHAY02', step: 2, dailyQty: 2000 },
  { productCode: 'SP-B', operation: 'Phay tinh',     operationJa: '仕上フライス', machineId: 'PHAY02', step: 3, dailyQty: 2000 },
  // Sản Phẩm C — 5 công đoạn
  { productCode: 'SP-C', operation: 'Phay tạo phôi', operationJa: 'ブランクフライス', machineId: 'PHAY01', step: 1, dailyQty: 500 },
  { productCode: 'SP-C', operation: 'Tiện thô',      operationJa: '粗旋削',   machineId: 'TIEN01', step: 2, dailyQty: 500 },
  { productCode: 'SP-C', operation: 'Phay bán tinh', operationJa: '中仕上フライス', machineId: 'PHAY02', step: 3, dailyQty: 500 },
  { productCode: 'SP-C', operation: 'Tiện tinh',     operationJa: '仕上旋削',  machineId: 'TIEN01', step: 4, dailyQty: 500 },
  { productCode: 'SP-C', operation: 'Cắt dây',       operationJa: 'ワイヤーカット', machineId: 'OTHER', step: 5, dailyQty: 500 },
];

// Helper: get routing entries for a machine
const getRoutingForMachine = (machineId) => ROUTING.filter(r => r.machineId === machineId);

// ============================================================================
// DATA PERSISTENCE — localStorage để lưu reports sau submit/save
// ============================================================================
const STORAGE_KEY = 'fcc_demo_reports';
const STORAGE_VERSION_KEY = 'fcc_demo_version';
// ★ Bump this version whenever data structure / seed logic changes.
//   Mismatched version → auto-clear stale localStorage on next load.
const DATA_VERSION = '2026-04-19-v5';

const loadSavedReports = () => {
  try {
    // Auto-clear stale data from old builds
    const savedVer = localStorage.getItem(STORAGE_VERSION_KEY);
    if (savedVer !== DATA_VERSION) {
      console.log('[persist] version mismatch — clearing stale data', savedVer, '→', DATA_VERSION);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_VERSION_KEY, DATA_VERSION);
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const savePersistReports = (reports) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    localStorage.setItem(STORAGE_VERSION_KEY, DATA_VERSION);
  } catch (e) { console.warn('[persist] save failed', e); }
};

// ============================================================================
// SETTER — cho phép main.jsx replace data từ middleware trước khi App render
// ============================================================================
export function __setAppMasterData({ machines: m, products: p, users: u, reports: r }) {
  if (Array.isArray(m) && m.length) machines = m;
  if (Array.isArray(p) && p.length) products = p;
  if (Array.isArray(u) && u.length) mockUsers = u;      // reassign mockUsers trực tiếp
  if (Array.isArray(r)) __overrideReports = r;
  console.log('[__setAppMasterData] overrides:', {
    machines: m?.length, products: p?.length, users: u?.length, reports: r?.length,
  });
}
let __overrideReports = null; // main.jsx set → dùng thay generateMockReports()

// ============================================================================
// MASTER DATA: 14 DOWNTIME REASONS (exact match with BM-02 form)
// ============================================================================
const downtimeReasons = [
  { id: 1, name_vi: 'Họp đầu ca', name_ja: '始業ミーティング', defaultMin: 5 },
  { id: 2, name_vi: 'Kiểm tra máy đầu ca', name_ja: '始業機械点検', defaultMin: 5 },
  { id: 3, name_vi: 'Chuẩn bị nguyên liệu', name_ja: '材料準備', defaultMin: 0 },
  { id: 4, name_vi: 'Chờ nguyên liệu', name_ja: '材料待ち', defaultMin: 0 },
  { id: 5, name_vi: 'Thay khuôn / dao cụ', name_ja: '金型・工具交換', defaultMin: 0 },
  { id: 6, name_vi: 'Hiệu chỉnh máy', name_ja: '機械調整', defaultMin: 0 },
  { id: 7, name_vi: 'Hỏng máy / sửa chữa', name_ja: '機械故障・修理', defaultMin: 0 },
  { id: 8, name_vi: 'Mất điện', name_ja: '停電', defaultMin: 0 },
  { id: 9, name_vi: 'Chờ QC kiểm tra', name_ja: 'QC検査待ち', defaultMin: 0 },
  { id: 10, name_vi: 'Đào tạo / họp', name_ja: '研修・会議', defaultMin: 0 },
  { id: 11, name_vi: 'Vệ sinh máy', name_ja: '機械清掃', defaultMin: 0 },
  { id: 12, name_vi: 'Viết báo cáo cuối ca', name_ja: '業務日報作成', defaultMin: 5 },
  { id: 13, name_vi: 'An toàn / 5S', name_ja: '安全・5S', defaultMin: 0 },
  { id: 14, name_vi: 'Lý do khác', name_ja: 'その他', defaultMin: 0 },
];

// ============================================================================
// MASTER DATA: OVERTIME REASONS
// OT is an independent layer on top of shift, never changes shift duration.
// ============================================================================
const overtimeReasons = [
  { id: 'OT01', name_vi: 'Bù kế hoạch chưa hoàn thành', name_ja: '計画未達補填' },
  { id: 'OT02', name_vi: 'Đơn hàng gấp', name_ja: '緊急オーダー' },
  { id: 'OT03', name_vi: 'Bù sản lượng do hỏng máy', name_ja: '機械故障補填' },
  { id: 'OT04', name_vi: 'Thay đổi kế hoạch đột xuất', name_ja: '計画変更対応' },
  { id: 'OT05', name_vi: 'Thiếu nhân lực ca sau', name_ja: '次ca人員不足補填' },
  { id: 'OT06', name_vi: 'Chuẩn bị đơn xuất khẩu', name_ja: '輸出準備' },
  { id: 'OT99', name_vi: 'Lý do khác', name_ja: 'その他' },
];
const getOvertimeReasonName = (id, lang) => {
  const r = overtimeReasons.find(x => x.id === id);
  return r ? r[`name_${lang}`] : id;
};

// ============================================================================
// MASTER DATA: NG REASON CODES (D01-D12 + D99)
// ============================================================================
const ngReasons = [
  { id: 'D01', name_vi: 'Lỗi kích thước', name_ja: '寸法不良' },
  { id: 'D02', name_vi: 'Lỗi bề mặt', name_ja: '表面不良' },
  { id: 'D03', name_vi: 'Lỗi hình dạng', name_ja: '形状不良' },
  { id: 'D04', name_vi: 'Lỗi lệch tâm', name_ja: '芯ズレ' },
  { id: 'D05', name_vi: 'Lỗi ren', name_ja: 'ネジ不良' },
  { id: 'D06', name_vi: 'Lỗi độ cứng', name_ja: '硬度不良' },
  { id: 'D07', name_vi: 'Lỗi mẻ/nứt', name_ja: '欠け・割れ' },
  { id: 'D08', name_vi: 'Lỗi ba via', name_ja: 'バリ' },
  { id: 'D09', name_vi: 'Lỗi lắp ghép', name_ja: '組立不良' },
  { id: 'D10', name_vi: 'Lỗi vật liệu', name_ja: '材料不良' },
  { id: 'D11', name_vi: 'Lỗi nhiệt luyện', name_ja: '熱処理不良' },
  { id: 'D12', name_vi: 'Lỗi mạ/phủ', name_ja: 'メッキ不良' },
  { id: 'D99', name_vi: 'Lỗi khác', name_ja: 'その他' },
];

// ============================================================================
// MASTER DATA: ROOT CAUSES (4M - Man, Machine, Material, Method)
// ============================================================================
const rootCauses = [
  // Man
  { id: 'M01', category: 'man', name_vi: 'Sai thao tác', name_ja: '操作ミス' },
  { id: 'M02', category: 'man', name_vi: 'Thiếu kinh nghiệm', name_ja: '経験不足' },
  // Machine
  { id: 'M03', category: 'machine', name_vi: 'Dao cụ mòn', name_ja: '工具摩耗' },
  { id: 'M04', category: 'machine', name_vi: 'Máy rung', name_ja: '機械振動' },
  { id: 'M05', category: 'machine', name_vi: 'Thông số sai', name_ja: 'パラメータ誤り' },
  { id: 'M06', category: 'machine', name_vi: 'Jig/Fixture sai', name_ja: '治具不良' },
  { id: 'M07', category: 'machine', name_vi: 'Calibration sai', name_ja: '校正不良' },
  // Material
  { id: 'M08', category: 'material', name_vi: 'Vật liệu lỗi', name_ja: '材料不良' },
  { id: 'M09', category: 'material', name_vi: 'Sai spec', name_ja: '仕様間違い' },
  { id: 'M10', category: 'material', name_vi: 'Độ ẩm/nhiệt', name_ja: '湿度・温度不良' },
  // Method
  { id: 'M11', category: 'method', name_vi: 'Chương trình CNC sai', name_ja: 'CNCプログラム誤り' },
  { id: 'M12', category: 'method', name_vi: 'Điều kiện cắt sai', name_ja: '切削条件誤り' },
  { id: 'M13', category: 'method', name_vi: 'Quy trình sai', name_ja: '工程不備' },
  { id: 'M14', category: 'method', name_vi: 'Thiếu kiểm tra', name_ja: '検査不足' },
  { id: 'M15', category: 'method', name_vi: 'Bản vẽ không rõ', name_ja: '図面不明確' },
];

// ============================================================================
// MASTER DATA: COUNTERMEASURES
// ============================================================================
const countermeasures = [
  { id: 'A01', name_vi: 'Đào tạo lại operator', name_ja: 'オペレータ再教育' },
  { id: 'A02', name_vi: 'Thay dao cụ', name_ja: '工具交換' },
  { id: 'A03', name_vi: 'Sửa chữa máy', name_ja: '機械修理' },
  { id: 'A04', name_vi: 'Chỉnh thông số', name_ja: 'パラメータ調整' },
  { id: 'A05', name_vi: 'Thay jig/fixture', name_ja: '治具交換' },
  { id: 'A06', name_vi: 'Hiệu chuẩn máy', name_ja: '機械校正' },
  { id: 'A07', name_vi: 'Đổi lô vật liệu', name_ja: '材料ロット交換' },
  { id: 'A08', name_vi: 'Sửa chương trình CNC', name_ja: 'CNCプログラム修正' },
  { id: 'A09', name_vi: 'Cập nhật quy trình', name_ja: '工程更新' },
  { id: 'A10', name_vi: 'Thêm bước kiểm tra', name_ja: '検査工程追加' },
  { id: 'A99', name_vi: 'Giải pháp khác', name_ja: 'その他' },
];

// ============================================================================
// END_DATA_MASTER_MARKER
// ============================================================================

// ============================================================================
// TEAMS & MOCK USERS
// FCC factory: 1 bộ phận (Gia công CNC) × 3 ca = 3 teams.
// Mỗi team: 1 Sub Leader + 4 Operators (1 người/máy).
// Sub Leader vừa duyệt vừa vận hành máy đầu tiên.
// ============================================================================
const TEAMS_DEF = [
  // Ca 1 (06:00-14:00) — khớp Odoo hr.employee, machine hardcoded
  { dept: 'Gia công CNC', line: 'Line Tiện', shiftNumber: 1,
    subLeaderName: 'Phạm Minh Đức',
    members: [
      { name: 'Nguyễn Văn An',  machineId: 'PHAY01' },
      { name: 'Trần Thị Bình',  machineId: 'PHAY02' },
      { name: 'Lê Văn Cường',   machineId: 'OTHER'  },
      { name: 'Đỗ Văn Hoàng',   machineId: ''       },
    ] },
  // Ca 2 (14:00-22:00)
  { dept: 'Gia công CNC', line: 'Line Tiện', shiftNumber: 2,
    subLeaderName: 'Hoàng Thị Em',
    members: [
      { name: 'Vũ Thị Dung',    machineId: 'PHAY01' },
      { name: 'Đặng Văn Dũng',  machineId: 'PHAY02' },
      { name: 'Bùi Thị Giang',  machineId: 'OTHER'  },
      { name: 'Lý Văn Khánh',   machineId: ''       },
    ] },
  // Ca 3 (22:00-06:00)
  { dept: 'Gia công CNC', line: 'Line Tiện', shiftNumber: 3,
    subLeaderName: 'Trần Văn Phú',
    members: [
      { name: 'Ngô Văn Hải',    machineId: 'PHAY01' },
      { name: 'Phan Thị Lan',   machineId: 'PHAY02' },
      { name: 'Võ Văn Minh',    machineId: 'OTHER'  },
      { name: 'Hồ Thị Ngà',     machineId: ''       },
    ] },
];

const _deptSlug = (dept) => dept.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
const teamIdOf = (dept, shiftNumber) => `team_${_deptSlug(dept)}_${shiftNumber}`;
const teamLabelOf = (dept, shiftNumber) => `${dept} · Ca ${shiftNumber}`;

const generateMockUsers = () => {
  const users = [];
  // Operator IDs khớp Odoo: Ca1=OP0XX, Ca2=OP1XX, Ca3=OP2XX
  const shiftOpPrefix = { 1: 'OP0', 2: 'OP1', 3: 'OP2' };
  TEAMS_DEF.forEach(team => {
    const teamMachines = machines.filter(m => m.dept === team.dept);
    const teamId = teamIdOf(team.dept, team.shiftNumber);
    // Sub Leader — LD001, LD002, LD003 → luôn TIEN01 (teamMachines[0])
    const ldId = `LD${String(team.shiftNumber).padStart(3, '0')}`;
    users.push({
      id: ldId,
      name: team.subLeaderName,
      role: 'team_leader',
      roleLabel: `Sub Leader · S${team.shiftNumber}`,
      dept: team.dept,
      line: team.line,
      shiftNumber: team.shiftNumber,
      machineId: teamMachines[0]?.id || '',
      teamId,
    });
    // 4 Operators per shift — machine hardcoded trong TEAMS_DEF khớp Odoo
    const prefix = shiftOpPrefix[team.shiftNumber] || 'OP0';
    team.members.forEach((member, k) => {
      const opNum = k + 1; // 1,2,3,4
      const opId = `${prefix}${String(opNum).padStart(2, '0')}`;
      users.push({
        id: opId,
        name: member.name,
        role: 'operator',
        roleLabel: `Operator · S${team.shiftNumber}`,
        dept: team.dept,
        line: team.line,
        shiftNumber: team.shiftNumber,
        machineId: member.machineId || '',
        teamId,
      });
    });
  });
  // Chief of CNC — gắn dept Gia công CNC
  users.push({ id: 'CF001', name: 'Hoàng Minh Đức', role: 'section_manager', roleLabel: 'Chief of CNC', dept: 'Gia công CNC' });
  // Ast Chief & các bộ phận khác — không gắn dept CNC
  users.push({ id: 'AC001', name: 'Phạm Văn Kiên', role: 'section_manager', roleLabel: 'Ast Chief', dept: 'Production' });
  users.push({ id: 'QA001', name: 'Vũ Thị Hương', role: 'qa', roleLabel: 'QA Inspector', dept: 'Quality' });
  users.push({ id: 'MT001', name: 'Đặng Văn Long', role: 'maintenance', roleLabel: 'Maintenance Lead', dept: 'Maintenance' });
  users.push({ id: 'DR001', name: 'Nguyễn Quang Vinh', role: 'director', roleLabel: 'Factory Director', dept: 'Management' });
  return users;
};

// ⚠ 'let' thay 'const' để main.jsx override với users từ middleware
let mockUsers = generateMockUsers();

const getUserById = (id) => mockUsers.find(u => u.id === id);
const getOperatorsByMachine = (machineId) => mockUsers.filter(u => u.role === 'operator' && u.machineId === machineId);
// All operators on the (dept, shift) team — used in report forms to populate the
// operator dropdown with every team member on that shift (not just the one
// primary operator for this machine).
// ★ Bao gồm cả Sub Leader (team_leader có machineId) vì leader kiêm operator
const getTeamOperators = (dept, shiftNumber) =>
  mockUsers.filter(u => (u.role === 'operator' || (u.role === 'team_leader' && !!u.machineId)) && u.dept === dept && u.shiftNumber === shiftNumber);
const getTeamLeaderByDept = (dept) => mockUsers.find(u => u.role === 'team_leader' && u.dept === dept);
// Per-shift resolver: each (dept, shiftNumber) pair has its own Sub Leader.
// Falls back to any leader in the department if the exact shift leader is missing.
const getTeamLeaderByDeptAndShift = (dept, shiftNumber) =>
  mockUsers.find(u => u.role === 'team_leader' && u.dept === dept && u.shiftNumber === shiftNumber)
  || mockUsers.find(u => u.role === 'team_leader' && u.dept === dept);
// ============================================================================
// I18N: Vietnamese + Japanese (FCC Vietnam)
// ============================================================================
const translations = {
  vi: {
    // App
    appTitle: 'Hệ thống Báo cáo Sản xuất',
    appSubtitle: 'FCC Vietnam - Smart Factory',
    companyName: 'FCC Vietnam Co., Ltd.',
    login: 'Đăng nhập',
    logout: 'Đăng xuất',
    selectUser: 'Chọn người dùng',
    selectTeam: 'Chọn team',
    teamSize: 'Quân số',
    people: 'người',
    deptPress: 'Press',
    deptCNC: 'CNC',
    deptMill: 'Mill',
    managementTab: 'Quản lý',
    language: 'Ngôn ngữ',
    // Navigation
    dashboard: 'Dashboard',
    reports: 'Báo cáo sản xuất',
    newReport: 'Tạo báo cáo mới',
    approvals: 'Phê duyệt',
    monthlyPlan: 'Kế hoạch tháng',
    analytics: 'Phân tích',
    settings: 'Cài đặt',
    ifsIntegration: 'Kết nối IFS',
    // Roles
    operator: 'Operator',
    teamLeader: 'Sub Leader',
    subLeader: 'Sub Leader',
    sectionManager: 'Ast Chief / Chief',
    astChief: 'Ast Chief',
    chief: 'Chief',
    qa: 'QA',
    maintenance: 'Bảo trì',
    director: 'Giám đốc',
    // BM-02 Form fields
    bm02Title: 'BÁO CÁO SẢN XUẤT',
    bm02Code: 'BM-02 / QĐ SX-01',
    department: 'Bộ phận',
    reportDate: 'Ngày báo cáo',
    machine: 'Tên máy',
    productionLine: 'Line sản xuất',
    shift: 'Ca',
    shift1: 'Ca 1',
    shift2: 'Ca 2',
    shift3: 'Ca 3',
    dailyPlanActual: 'Kế hoạch ngày / Thực tế',
    otPlanLabel: 'Kế hoạch OT',
    otPlanLegend: 'Chú thích OT',
    shiftOperator: 'Người làm',
    shiftLeader: 'Sub / Leader',
    confirmAst: 'Xác nhận Ast / Chief',
    // Product entry
    productCode: 'Mã SP',
    productName: 'Tên SP',
    lotNumber: 'Số lô',
    okCount: 'OK (SL tốt)',
    ngTestCount: 'NG TEST (Test máy)',
    ngCount: 'NG (Sản xuất)',
    ngPendingCount: 'NG chờ xử lý',
    ngReason: 'Lý do NG',
    ifsSynced: 'Đã nhập IFS',
    addProduct: 'Thêm sản phẩm',
    removeProduct: 'Xóa',
    selectProduct: 'Chọn sản phẩm',
    // Multi-defect
    defectEntries: 'Lỗi sản xuất (NG)',
    addDefect: 'Thêm lỗi',
    removeDefect: 'Xóa lỗi',
    defectType: 'Loại lỗi',
    defectQty: 'SL sản phẩm lỗi',
    defectDetail: 'Chi tiết nguyên nhân',
    defectCountermeasure: 'Biện pháp khắc phục',
    totalNGAuto: 'Tổng NG (tự tính)',
    noDefects: 'Chưa có lỗi sản xuất',
    defectSummary: 'Tổng hợp lỗi',
    // Downtime
    downtimeTitle: 'Lý do ngừng máy (phút)',
    downtimeReason: 'Lý do',
    downtimeMinutes: 'Phút',
    downtimeShift: 'Ca',
    totalDowntime: 'Tổng ngừng máy',
    addDowntime: 'Thêm',
    // Capacity
    capacity: 'Công suất',
    rate: 'Rate',
    planQty: 'Kế hoạch',
    actualQty: 'Thực tế',
    progress: 'Tiến độ',
    // 4M Analysis (quick input)
    fourMAnalysis: 'Phân tích 4M (chọn nhanh)',
    rootCause: 'Nguyên nhân gốc',
    countermeasure: 'Biện pháp khắc phục',
    man: 'Con người',
    machineCat: 'Máy móc',
    material: 'Vật liệu',
    method: 'Phương pháp',
    // Status
    status: 'Trạng thái',
    draft: 'Nháp',
    submitted: 'Đã gửi',
    leaderApproved: 'Leader đã duyệt',
    chiefApproved: 'Hoàn thành',
    rejected: 'Bị từ chối',
    pending: 'Đang chờ',
    approved: 'Đã duyệt',
    // Actions
    save: 'Lưu nháp',
    submit: 'Gửi duyệt',
    approve: 'Phê duyệt',
    reject: 'Từ chối',
    cancel: 'Hủy',
    edit: 'Sửa',
    withdraw: 'Rút đơn',
    withdrawConfirm: 'Bạn có chắc muốn rút ca này? Ca sẽ quay về trạng thái Nháp để chỉnh sửa.',
    withdrawSuccess: 'Đã rút đơn thành công',
    withdrawShiftLabel: 'Rút ca',
    rejectionHistory: 'Lịch sử từ chối',
    rejectedAt: 'Từ chối lúc',
    resubmittedAt: 'Nộp lại lúc',
    rejectedByLabel: 'Bởi',
    delete: 'Xóa',
    view: 'Xem',
    export: 'Xuất',
    search: 'Tìm kiếm',
    filter: 'Lọc',
    all: 'Tất cả',
    confirm: 'Xác nhận',
    close: 'Đóng',
    // IFS
    ifsPullData: 'Tải dữ liệu từ IFS',
    ifsPushData: 'Đồng bộ lên IFS',
    ifsConnected: 'Kết nối IFS',
    ifsDisconnected: 'Chưa kết nối',
    ifsSyncTime: 'Thời gian đồng bộ cuối',
    ifsMasterData: 'Master Data IFS',
    keyIFS: 'Key IFS',
    docCode: 'Doc Code',
    // Monthly Plan (BM-01)
    bm01Title: 'KẾ HOẠCH SẢN XUẤT THÁNG',
    bm01Code: 'BM-01 / QĐ SX-01',
    monthYear: 'Tháng / Năm',
    selectMachine: 'Chọn máy',
    csCoDelivery: 'CSCO (IFS)',
    csActualDelivery: 'COACTUAL',
    nextProcessPlan: 'Công đoạn sau - Kế hoạch',
    nextProcessActual: 'Công đoạn sau - Thực tế',
    mrpStart: 'MRP 2nd START',
    mrpEnd: 'MRP 2nd END',
    plannedInv: 'Tồn dự định',
    actualInv: 'Tồn thực tế',
    ngTestMachine: 'NG TEST máy',
    ngOther: 'NG khác',
    // Dashboard
    totalReports: 'Tổng báo cáo',
    todayReports: 'Báo cáo hôm nay',
    achievementRate: 'Tỉ lệ đạt KH',
    defectRate: 'Tỉ lệ NG',
    downtimeTotal: 'Tổng dừng máy',
    machinesOnline: 'Máy đang hoạt động',
    pendingApprovals: 'Chờ phê duyệt',
    // Overtime
    overtimeTitle: 'Làm thêm giờ (OT)',
    overtimeShort: 'OT',
    addOvertime: 'Thêm OT',
    overtimeReason: 'Lý do OT',
    overtimeMinutes: 'Phút OT',
    overtimeTotal: 'Tổng OT',
    inShift: 'Trong ca',
    overtime: 'Ngoài ca (OT)',
    overtimeOutput: 'Sản lượng OT',
    overtimeNone: 'Không có OT',
    overtimeHint: 'OT nằm ngoài khung giờ ca và không làm thay đổi thời lượng ca.',
    otSourcePlanOn: '📋 OT theo kế hoạch',
    otSourcePlanOff: '🚫 Kế hoạch: không OT',
    otSourceSettingOn: '🏢 OT theo setting tổ chức',
    otSourceSettingOff: 'OT đang tắt',
    otPlannedMin: 'Kế hoạch',
    otSettingTitle: 'Cho phép OT (Overtime)',
    otSettingDesc: 'Bật để các báo cáo có thể ghi nhận OT khi không có kế hoạch cụ thể. Cấp độ kế hoạch luôn ưu tiên cao hơn setting này.',
    otSettingOnlyManager: 'Chỉ Ast/Chief (Section Manager) có quyền thay đổi',
    // Validation
    validationTitle: 'Dữ liệu chưa hợp lệ',
    validationHint: 'Vui lòng sửa các lỗi bên dưới trước khi lưu hoặc gửi phê duyệt',
    errOperatorMissing: 'Thiếu tên người vận hành (ca này)',
    errLeaderMissing: 'Thiếu tên Sub Leader (ca này)',
    errShiftTimeMissing: 'Thiếu giờ bắt đầu hoặc giờ kết thúc ca',
    errShiftTimeEndBefore: 'Giờ kết thúc phải sau giờ bắt đầu',
    errShiftTimeTooShort: 'Thời lượng ca quá ngắn (tối thiểu 1 giờ)',
    errShiftTimeTooLong: 'Thời lượng ca vượt quá 16 giờ (bao gồm OT)',
    errProductEmpty: 'Ca này chưa có sản phẩm nào',
    errOkMissing: 'Thiếu số lượng OK',
    errOkExceedsPlan: 'OK vượt quá số lượng kế hoạch',
    errLotMissing: 'Thiếu số lô',
    errNgReasonMissing: 'Có NG nhưng chưa chọn lý do',
    errRootCauseMissing: 'Có NG nhưng chưa chọn 4M',
    errCountermeasureMissing: 'Có NG nhưng chưa chọn biện pháp',
    errDefectQtyZero: 'SL sản phẩm lỗi phải > 0',
    errDefectDetailMissing: 'Có NG nhưng chưa chọn nguyên nhân chi tiết',
    errDefectCounterMissing: 'Có NG nhưng chưa chọn biện pháp khắc phục',
    errDefectEntryRequired: 'Có NG sản xuất nhưng chưa nhập chi tiết lỗi',
    errDowntimeTimeMissing: 'Downtime thiếu giờ bắt đầu/kết thúc',
    errDowntimeMinutesZero: 'Downtime có thời lượng bằng 0',
    errDowntimeOutsideShift: 'Giờ downtime phải nằm trong khung ca làm việc',
    errDowntimeStartOutside: 'Giờ bắt đầu downtime ngoài khung ca',
    errDowntimeEndOutside: 'Giờ kết thúc downtime ngoài khung ca',
    errDowntimeEndBeforeStart: 'Giờ kết thúc downtime phải sau giờ bắt đầu',
    errDowntimeTooLong: 'Thời lượng downtime không hợp lý',
    errOtTimeMissing: 'OT thiếu giờ bắt đầu/kết thúc',
    errOtReasonMissing: 'OT chưa chọn lý do',
    errOtOutputMissing: 'OT đã nhập giờ nhưng chưa có sản lượng OK',
    errOtProductMissing: 'OT chưa chọn sản phẩm',
    errorsCount: 'lỗi',
    viewErrors: 'Xem lỗi',
    fixBeforeSave: 'Sửa lỗi trước khi lưu',
    // Misc
    total: 'Tổng',
    loading: 'Đang tải',
    noData: 'Không có dữ liệu',
    noPendingApproval: 'Không có đơn cần duyệt',
    noHighNG: 'Không có báo cáo NG cao',
    noCriticalDowntime: 'Không có sự cố dừng máy nghiêm trọng',
    required: 'Bắt buộc',
    yes: 'Có',
    no: 'Không',
    min: 'phút',
    unit: 'cái',
    // Pickers
    numberPickerTitle: 'Nhập số',
    timePickerTitle: 'Chọn giờ',
    reset: 'Reset',
    pickerHint: 'Kéo hoặc cuộn chuột để thay đổi',
    hour: 'Giờ',
    minute: 'Phút',
    hourLabel: 'Giờ',
    minuteLabel: 'Phút',
    hourPickerDesc: 'Vòng ngoài 1-12, vòng trong 13-00',
    minPickerDesc: 'Thiết lập theo từng phút',
    alreadyAdded: 'Đã thêm rồi',
    // Dashboard labels
    noReportToday: 'Chưa có báo cáo hôm nay',
    trend7Days: 'Xu hướng 7 ngày',
    trend14Days: 'Xu hướng 14 ngày',
    trend30Days: 'Xu hướng 30 ngày',
    myReports: 'Báo cáo của tôi',
    byMachine: 'Theo máy',
    byDepartment: 'Theo bộ phận',
    allDepartments: 'Tất cả bộ phận',
    needsConfirmation: 'Cần xác nhận',
    waitingChiefConfirm: 'Cần Chief xác nhận',
    qualityDepartmentLong: 'Bộ phận chất lượng',
    maintenanceDepartmentLong: 'Bộ phận bảo trì',
    ngByType: 'Phân loại NG (TOP 8)',
    ngTrend14Days: 'NG 14 ngày',
    breakdown: 'Hỏng máy',
    totalMachines: 'Tổng số máy',
    completedReports: 'Đã hoàn thành',
    downtimeByMachine: 'Downtime theo máy',
    breakdownReports: 'Báo cáo có hỏng máy',
    outputByLineToday: 'Sản lượng theo line (hôm nay)',
    machineStatusToday: 'Tình trạng máy (hôm nay)',
    autoFilledFromPlan: 'Đã tự động điền từ kế hoạch',
    shiftNotStarted: 'Ca làm việc này chưa bắt đầu',
    viewOnlyMode: 'Chế độ chỉ xem',
    startTime: 'Giờ bắt đầu',
    endTime: 'Giờ kết thúc',
    startShort: 'Bắt đầu',
    endShort: 'Kết thúc',
    products: 'Sản phẩm',
    productLabel: 'Sản phẩm',
    defectLabel: 'NG',
    noDowntime: 'Không có dừng máy',
    total3Shifts: 'Tổng 3 ca',
    alreadyInShift: 'Đã có trong ca này',
    approvalHistory: 'Lịch sử phê duyệt',
    achievementByMachine: 'Tỉ lệ đạt KH theo máy',
    syncLog: 'Nhật ký đồng bộ',
    notePlaceholder: 'Ghi chú...',
    byPlan: 'Theo KH',
    myShiftTag: 'Ca của bạn',
    shiftNotStartedTitle: 'Ca chưa đến',
    backToMyShift: 'Quay lại ca của bạn',
    dataWillAppear: 'Dữ liệu sẽ xuất hiện sau khi operator ca này nhập báo cáo.',
    errEndBeforeStart: 'Giờ kết thúc phải sau giờ bắt đầu',
    errTimeOutsideShift: 'Giờ không nằm trong khung ca (bao gồm ca đêm qua hôm sau)',
    noteCurrentPlanSameEdit: 'Nếu đúng kế hoạch thì submit, có chênh lệch thì chỉnh sửa số thực tế. Số kế hoạch không chỉnh sửa được.',
    asPlanned: 'Đúng kế hoạch',
    pendingShiftsTag: 'ca chờ duyệt',
    approvedShiftsTag: 'ca duyệt',
    latest: 'gần nhất',
    achieved: 'Đạt',
    noReportYet: 'Chưa có',
    allMachines: 'Tất cả máy',
    totalMachinesShort: 'Tổng máy',
    downtimeTrend14: 'Xu hướng dừng máy 14 ngày',
    ngCategory: 'Phân loại NG',
    productionByLine: 'Sản lượng theo line',
    machineStatus: 'Tình trạng máy',
    today: 'hôm nay',
    needsConfirmShort: 'Cần xác nhận',
    confirmedToday: 'Xác nhận hôm nay',
    allApprovedNotice: 'Đã được Sub Leader duyệt cả 3 ca. Đang chờ Ast/Chief xác nhận cuối cùng.',
    pendingLeaderFullMsg: 'Đang chờ Sub Leader duyệt ca này',
    pendingChiefFullMsg: 'Đang chờ Ast/Chief xác nhận báo cáo',
    achievementRateByMachine: 'Tỉ lệ đạt KH theo máy',
    dateRestrictHint: 'Chỉ chọn được từ 3 ngày trước đến hôm nay',
    // Approval spec
    bulkApprove: 'Duyệt hàng loạt',
    bulkReject: 'Từ chối đã chọn',
    quickApproveNormal: 'Duyệt nhanh tất cả báo cáo bình thường',
    selectAll: 'Chọn tất cả',
    clearSelection: 'Bỏ chọn',
    selectedCount: 'đã chọn',
    filterAll: 'Tất cả',
    filterNormal: 'Bình thường',
    filterAbnormal: 'Bất thường',
    normalReports: 'Báo cáo bình thường',
    abnormalReports: 'Báo cáo cần review',
    flagNgHigh: 'NG cao',
    flagDowntimeLong: 'Downtime dài',
    flagOvertime: 'Có OT',
    flagOtNoReason: 'OT thiếu lý do',
    manualReviewRequired: 'Cần review thủ công',
    bulkBlockedHint: 'Báo cáo này cần review — không thể duyệt hàng loạt',
    noNormalReports: 'Không có báo cáo bình thường nào',
    noAbnormalReports: 'Không có báo cáo bất thường',
    noPendingReports: 'Không có báo cáo chờ duyệt',
    approveConfirmTitle: 'Xác nhận duyệt hàng loạt',
    approveConfirmMsg: 'Bạn có chắc muốn duyệt các báo cáo đã chọn?',
    confirmApprove: 'Duyệt',
    // Rules
    ruleNgHigh: 'NG > 5%',
    ruleDowntimeLong: 'Downtime > 60 phút',
    ruleOtUnreasoned: 'Có OT nhưng chưa nhập lý do',
    // History header
    recentApproved: 'Đã duyệt gần đây',
    approvalLevelNote: 'Quy trình phê duyệt: Operator → Sub Leader → Ast/Chief',
  },
  ja: {
    appTitle: '生産報告システム',
    appSubtitle: 'FCC Vietnam - スマートファクトリー',
    companyName: 'FCC Vietnam Co., Ltd.',
    login: 'ログイン',
    logout: 'ログアウト',
    selectUser: 'ユーザー選択',
    selectTeam: 'チーム選択',
    teamSize: '人数',
    people: '名',
    deptPress: 'プレス',
    deptCNC: 'CNC',
    deptMill: 'ミル',
    managementTab: '管理',
    language: '言語',
    dashboard: 'ダッシュボード',
    reports: '生産報告',
    newReport: '新規報告',
    approvals: '承認',
    monthlyPlan: '月次計画',
    analytics: '分析',
    settings: '設定',
    ifsIntegration: 'IFS連携',
    operator: 'オペレータ',
    teamLeader: 'サブリーダー',
    subLeader: 'サブリーダー',
    sectionManager: 'アストチーフ／チーフ',
    astChief: 'アストチーフ',
    chief: 'チーフ',
    qa: '品質管理',
    maintenance: '保全',
    director: '工場長',
    bm02Title: '生産報告書',
    bm02Code: 'BM-02 / QĐ SX-01',
    department: '部署',
    reportDate: '報告日',
    machine: '機械名',
    productionLine: 'ライン',
    shift: 'シフト',
    shift1: '1シフト',
    shift2: '2シフト',
    shift3: '3シフト',
    dailyPlanActual: '日次計画 / 実績',
    otPlanLabel: '残業計画 (OT Plan)',
    otPlanLegend: 'OT凡例',
    shiftOperator: '作業者',
    shiftLeader: 'サブ／リーダー',
    confirmAst: 'アストチーフ／チーフ承認',
    productCode: '品番',
    productName: '品名',
    lotNumber: 'ロット番号',
    okCount: 'OK数',
    ngTestCount: 'NG TEST (機械テスト)',
    ngCount: 'NG (生産)',
    ngPendingCount: 'NG処理待ち',
    ngReason: 'NG理由',
    ifsSynced: 'IFS登録済',
    addProduct: '製品追加',
    removeProduct: '削除',
    selectProduct: '製品選択',
    // Multi-defect
    defectEntries: '生産不良 (NG)',
    addDefect: '不良追加',
    removeDefect: '削除',
    defectType: '不良種類',
    defectQty: '不良品数',
    defectDetail: '原因詳細',
    defectCountermeasure: '対策',
    totalNGAuto: '合計NG (自動計算)',
    noDefects: '生産不良なし',
    defectSummary: '不良集計',
    downtimeTitle: '停止理由 (分)',
    downtimeReason: '理由',
    downtimeMinutes: '分',
    downtimeShift: 'シフト',
    totalDowntime: '合計停止',
    addDowntime: '追加',
    capacity: '能力',
    rate: 'レート',
    planQty: '計画',
    actualQty: '実績',
    progress: '進捗',
    fourMAnalysis: '4M分析 (クイック選択)',
    rootCause: '原因',
    countermeasure: '対策',
    man: '人',
    machineCat: '機械',
    material: '材料',
    method: '方法',
    status: 'ステータス',
    draft: '下書き',
    submitted: '提出済み',
    leaderApproved: 'リーダー承認済み',
    chiefApproved: '完了',
    rejected: '却下',
    pending: '保留',
    approved: '承認済',
    save: '下書き保存',
    submit: '承認依頼',
    approve: '承認',
    reject: '却下',
    cancel: 'キャンセル',
    edit: '編集',
    withdraw: '取り下げ',
    withdrawConfirm: 'このシフトを取り下げますか？下書きに戻して編集できます。',
    withdrawSuccess: '取り下げが完了しました',
    withdrawShiftLabel: 'シフト取り下げ',
    rejectionHistory: '却下履歴',
    rejectedAt: '却下日時',
    resubmittedAt: '再提出日時',
    rejectedByLabel: '担当者',
    delete: '削除',
    view: '表示',
    export: 'エクスポート',
    search: '検索',
    filter: 'フィルタ',
    all: '全て',
    confirm: '確認',
    close: '閉じる',
    ifsPullData: 'IFSからデータ取得',
    ifsPushData: 'IFSへ同期',
    ifsConnected: 'IFS接続中',
    ifsDisconnected: '未接続',
    ifsSyncTime: '最終同期時刻',
    ifsMasterData: 'IFSマスターデータ',
    keyIFS: 'Key IFS',
    docCode: 'Doc Code',
    bm01Title: '月次生産計画',
    bm01Code: 'BM-01 / QĐ SX-01',
    monthYear: '年月',
    selectMachine: '機械選択',
    csCoDelivery: 'CSCO (IFS)',
    csActualDelivery: 'COACTUAL',
    nextProcessPlan: '次工程計画',
    nextProcessActual: '次工程実績',
    mrpStart: 'MRP 2nd 開始',
    mrpEnd: 'MRP 2nd 終了',
    plannedInv: '計画在庫',
    actualInv: '実在庫',
    ngTestMachine: 'NG テスト機械',
    ngOther: 'NG その他',
    totalReports: '総報告数',
    todayReports: '本日の報告',
    achievementRate: '達成率',
    defectRate: '不良率',
    downtimeTotal: '総停止時間',
    machinesOnline: '稼働中機械',
    pendingApprovals: '承認待ち',
    // Overtime
    overtimeTitle: '残業 (OT)',
    overtimeShort: 'OT',
    addOvertime: 'OT追加',
    overtimeReason: 'OT理由',
    overtimeMinutes: 'OT時間',
    overtimeTotal: '残業合計',
    inShift: '定時内',
    overtime: '時間外 (OT)',
    overtimeOutput: 'OT生産数',
    overtimeNone: '残業なし',
    overtimeHint: 'OTはシフト時間外に独立して記録され、シフトの長さは変更しません。',
    otSourcePlanOn: '📋 計画に基づくOT',
    otSourcePlanOff: '🚫 計画: OTなし',
    otSourceSettingOn: '🏢 組織設定のOT',
    otSourceSettingOff: 'OTは無効です',
    otPlannedMin: '計画',
    otSettingTitle: '残業 (OT) を許可する',
    otSettingDesc: 'ONにすると、計画で明示されていない場合でもOTを記録できます。計画が設定されている場合は計画が優先されます。',
    otSettingOnlyManager: 'Ast/Chief (セクションマネージャー) のみ変更可能',
    // Validation
    validationTitle: '入力エラーがあります',
    validationHint: '保存または提出する前に、以下のエラーを修正してください',
    errOperatorMissing: '作業者名が未入力です (当シフト)',
    errLeaderMissing: 'サブリーダー名が未入力です (当シフト)',
    errShiftTimeMissing: 'シフト開始時刻または終了時刻が未入力です',
    errShiftTimeEndBefore: '終了時刻は開始時刻より後にしてください',
    errShiftTimeTooShort: 'シフト時間が短すぎます (最短1時間)',
    errShiftTimeTooLong: 'シフト時間が16時間を超えています (OT含む)',
    errProductEmpty: '当シフトに製品が登録されていません',
    errOkMissing: 'OK数が未入力です',
    errOkExceedsPlan: 'OK数が計画を超えています',
    errLotMissing: 'ロット番号が未入力です',
    errNgReasonMissing: 'NGがありますが理由が未選択です',
    errRootCauseMissing: 'NGがありますが4Mが未選択です',
    errCountermeasureMissing: 'NGがありますが対策が未選択です',
    errDefectQtyZero: '不良品数は1以上必要です',
    errDefectDetailMissing: 'NGがありますが原因詳細が未選択です',
    errDefectCounterMissing: 'NGがありますが対策が未選択です',
    errDefectEntryRequired: 'NG生産がありますが不良詳細が未入力です',
    errDowntimeTimeMissing: '停止時間の開始/終了が未入力です',
    errDowntimeMinutesZero: '停止時間がゼロです',
    errDowntimeOutsideShift: '停止時間はシフト時間内でなければなりません',
    errDowntimeStartOutside: '停止開始時刻がシフト範囲外です',
    errDowntimeEndOutside: '停止終了時刻がシフト範囲外です',
    errDowntimeEndBeforeStart: '停止終了時刻は開始時刻より後にしてください',
    errDowntimeTooLong: '停止時間が長すぎます',
    errOtTimeMissing: 'OTの開始/終了時刻が未入力です',
    errOtReasonMissing: 'OT理由が未選択です',
    errOtOutputMissing: 'OT時間が入力されていますが生産数 (OK) が未入力です',
    errOtProductMissing: 'OTの製品が未選択です',
    errorsCount: '件のエラー',
    viewErrors: 'エラーを表示',
    fixBeforeSave: '保存前にエラーを修正してください',
    total: '合計',
    loading: '読み込み中',
    noData: 'データなし',
    noPendingApproval: '承認待ちの報告はありません',
    noHighNG: 'NG高の報告はありません',
    noCriticalDowntime: '重大な停止はありません',
    required: '必須',
    yes: 'はい',
    no: 'いいえ',
    min: '分',
    unit: '個',
    // Pickers
    numberPickerTitle: '数値入力',
    timePickerTitle: '時刻選択',
    reset: 'リセット',
    pickerHint: 'ドラッグまたはスクロールで変更',
    hour: '時',
    minute: '分',
    hourLabel: '時',
    minuteLabel: '分',
    hourPickerDesc: '外輪 1-12, 内輪 13-00',
    minPickerDesc: '1分単位で設定可',
    alreadyAdded: '既に追加済',
    // Dashboard labels
    noReportToday: '本日の報告未作成',
    trend7Days: '7日間推移',
    trend14Days: '14日間推移',
    trend30Days: '30日間推移',
    myReports: '私の報告',
    byMachine: '機械別実績',
    byDepartment: '部署別実績',
    allDepartments: '全工場',
    needsConfirmation: '確認待ち',
    waitingChiefConfirm: '最終確認待ち',
    qualityDepartmentLong: '品質管理部',
    maintenanceDepartmentLong: '保全部',
    ngByType: 'NG種類別 (TOP 8)',
    ngTrend14Days: 'NG 14日間推移',
    breakdown: '故障',
    totalMachines: '全機械',
    completedReports: '完了報告',
    downtimeByMachine: '機械別停止時間',
    breakdownReports: '機械故障',
    outputByLineToday: 'ライン別生産量 (本日)',
    machineStatusToday: '全機械ステータス (本日)',
    autoFilledFromPlan: '生産計画から自動入力済み',
    shiftNotStarted: 'このシフトはまだ始まっていません',
    viewOnlyMode: '閲覧モード',
    startTime: '開始時刻',
    endTime: '終了時刻',
    startShort: '開始',
    endShort: '終了',
    products: '生産ライン',
    productLabel: '製品',
    defectLabel: '不具合',
    noDowntime: '停止なし',
    total3Shifts: '全シフト合計',
    alreadyInShift: '既に追加済み',
    approvalHistory: '承認履歴',
    achievementByMachine: '機械別達成率',
    syncLog: '同期ログ',
    notePlaceholder: 'メモ...',
    byPlan: '計画',
    myShiftTag: '自シフト',
    shiftNotStartedTitle: 'シフト未開始',
    backToMyShift: '自分のシフトに戻る',
    dataWillAppear: 'このシフトのオペレータが報告を入力すると表示されます。',
    errEndBeforeStart: '終了時刻は開始時刻より後にしてください',
    errTimeOutsideShift: '時刻がシフト時間外です (夜勤の翌日跨ぎは有効)',
    noteCurrentPlanSameEdit: '計画通りなら提出、差異がある場合は実績を修正してください。計画数量は編集できません。',
    asPlanned: '計画通り',
    pendingShiftsTag: '直承認待',
    approvedShiftsTag: '直承認済',
    latest: '最新',
    achieved: '達成',
    noReportYet: '未作成',
    allMachines: '全機械',
    totalMachinesShort: '全機械',
    downtimeTrend14: '停止時間推移 (14日)',
    ngCategory: 'NG種類別',
    productionByLine: 'ライン別生産量',
    machineStatus: '機械ステータス',
    today: '本日',
    needsConfirmShort: '確認待ち',
    confirmedToday: '本日確認済',
    allApprovedNotice: 'Sub Leaderにより全3直承認済み。Ast/Chiefによる最終確認待ち。',
    pendingLeaderFullMsg: 'Sub Leader承認待ちです',
    pendingChiefFullMsg: 'Ast/Chief最終確認待ちです',
    achievementRateByMachine: '機械別達成率',
    dateRestrictHint: '本日から3日前まで選択可能',
    // Approval spec
    bulkApprove: '一括承認',
    bulkReject: '選択を却下',
    quickApproveNormal: '正常な報告をクイック承認',
    selectAll: 'すべて選択',
    clearSelection: '選択解除',
    selectedCount: '件選択',
    filterAll: 'すべて',
    filterNormal: '正常',
    filterAbnormal: '異常',
    normalReports: '正常な報告',
    abnormalReports: 'レビュー必要',
    flagNgHigh: 'NG高',
    flagDowntimeLong: '停止長',
    flagOvertime: 'OTあり',
    flagOtNoReason: 'OT理由未入力',
    manualReviewRequired: '手動レビュー必要',
    bulkBlockedHint: 'この報告は一括承認できません — 個別確認してください',
    noNormalReports: '正常な報告はありません',
    noAbnormalReports: '異常な報告はありません',
    noPendingReports: '承認待ちの報告はありません',
    approveConfirmTitle: '一括承認の確認',
    approveConfirmMsg: '選択した報告を承認してよろしいですか？',
    confirmApprove: '承認',
    ruleNgHigh: 'NG > 5%',
    ruleDowntimeLong: '停止 > 60分',
    ruleOtUnreasoned: 'OTあり 理由未入力',
    recentApproved: '最近承認済み',
    approvalLevelNote: '承認フロー: Operator → Sub Leader → Ast/Chief',
  },
};
// ============================================================================
// MOCK REPORTS GENERATOR (machine-based, 3 shifts, BM-02 format)
// ============================================================================
const generateMockReports = () => {
  const rand = createSeededRandom(20260418);
  const reports = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const statuses = ['chief_approved', 'chief_approved', 'chief_approved', 'leader_approved', 'submitted', 'draft', 'rejected'];

  // Generate past 7 working days for each machine (skip Sundays)
  for (let d = 1; d <= 10; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    if (date.getDay() === 0) continue; // skip Sunday
    const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

    machines.forEach((machine, mi) => {

      const reportId = `RPT-${dateStr.replace(/-/g, '')}-${machine.id}`;
      const statusIdx = d === 0 ? Math.floor(rand() * 4) : (d < 3 ? (rand() < 0.3 ? 3 : 2) : 2);
      const status = statuses[statusIdx] || 'chief_approved';

      // Map overall status to per-shift statuses. For today's partially-filled
      // reports, some shifts may still be in earlier stages.
      const perShiftStatusFor = (shiftNum) => {
        if (status === 'chief_approved') return 'leader_approved';
        if (status === 'leader_approved') return 'leader_approved';
        if (status === 'rejected') return shiftNum === 2 ? 'rejected' : 'leader_approved';
        if (status === 'submitted') {
          // Mix: shift 1 approved, shift 2 pending leader, shift 3 draft
          if (shiftNum === 1) return 'leader_approved';
          if (shiftNum === 2) return 'submitted';
          return 'draft';
        }
        return 'draft';
      };

      // 3 shifts — each shift routes to its own (dept, shiftNumber) Sub Leader
      const shiftData = [1, 2, 3].map(shiftNum => {
        const operators = getOperatorsByMachine(machine.id);
        const operator = operators[(mi + shiftNum + d) % operators.length];
        const leader = getTeamLeaderByDeptAndShift(machine.dept, shiftNum);

        // Products for this machine — from ROUTING
        const machineRoutes = getRoutingForMachine(machine.id);
        const productEntries = [];
        machineRoutes.forEach((route, pi) => {
          const product = findProductByCode(route.productCode);
          if (!product) return;
          // Phân bổ khớp guideline: Ca1=ceil(N/3), Ca2=ceil(rem/2), Ca3=rest
          const _q1 = Math.ceil(route.dailyQty / 3);
          const _q2 = Math.ceil((route.dailyQty - _q1) / 2);
          const _q3 = route.dailyQty - _q1 - _q2;
          const planQty = [_q1, _q2, _q3][shiftNum - 1];
          const okCount = Math.floor(planQty * (0.88 + rand() * 0.1));
          const ngTest = Math.floor(rand() * 5);
          const ngCount = Math.floor(rand() * 8);
          const ngPending = Math.floor(rand() * 3);

          // Generate multi-defect entries for production NG (not ngTest, not ngPending)
          const defectEntries = ngCount > 0 ? (() => {
            const numDefects = Math.min(ngCount, 1 + Math.floor(rand() * 3)); // 1-3 defect types
            const entries = [];
            let remaining = ngCount;
            for (let i = 0; i < numDefects; i++) {
              const qty = i === numDefects - 1 ? remaining : Math.max(1, Math.floor(remaining * rand()));
              remaining -= qty;
              const rc = rootCauses[Math.floor(rand() * rootCauses.length)];
              entries.push({
                defectType: ngReasons[Math.floor(rand() * ngReasons.length)].id || 'D01',
                quantity: qty,
                rootCause4M: rc.category,
                rootCauseDetail: rc.id,
                countermeasure: countermeasures[Math.floor(rand() * countermeasures.length)].id,
              });
            }
            return entries;
          })() : [];

          productEntries.push({
            id: `pe-${reportId}-s${shiftNum}-${pi}`,
            productCode: product.code,
            productName_vi: `${product.name_vi} — ${route.operation}`,
            productName_ja: `${product.name_ja} — ${route.operationJa || route.operation}`,
            operationName: route.operation,
            keyIFS: product.keyIFS,
            docCode: product.docCode,
            lotNumber: `L${dateStr.replace(/-/g, '')}-${machine.id.substring(0, 6)}-S${shiftNum}R${route.step}`,
            planQty,
            okCount,
            ng: ngCount,
            ngTest,
            ngPending,
            defectEntries,
            ifsSynced: status === 'chief_approved' && rand() < 0.7,
          });
        });

        // Downtime entries (some random reasons per shift)
        const downtimeEntries = [];
        // Always include default 5-min reasons
        downtimeReasons.filter(r => r.defaultMin > 0).forEach(r => {
          downtimeEntries.push({ reasonId: r.id, minutes: r.defaultMin });
        });
        // Add 1-3 random additional reasons
        const extraCount = Math.floor(rand() * 3);
        for (let ei = 0; ei < extraCount; ei++) {
          const reason = downtimeReasons[Math.floor(rand() * downtimeReasons.length)];
          if (!downtimeEntries.find(e => e.reasonId === reason.id)) {
            downtimeEntries.push({ reasonId: reason.id, minutes: 5 + Math.floor(rand() * 25) });
          }
        }

        const shiftStatus = perShiftStatusFor(shiftNum);
        return {
          shiftNumber: shiftNum,
          operatorId: operator?.id || '',
          operatorName: operator?.name || 'Unknown',
          leaderId: leader?.id || '',
          leaderName: leader?.name || 'Unknown',
          productEntries,
          downtimeEntries,
          // Per-shift approval fields
          status: shiftStatus,
          submittedAt: shiftStatus !== 'draft' ? `${dateStr}T${18 + shiftNum}:00:00` : null,
          approvedByLeader: ['leader_approved'].includes(shiftStatus) ? (leader?.id || null) : null,
          approvedByLeaderAt: ['leader_approved'].includes(shiftStatus) ? `${dateStr}T${19 + shiftNum}:00:00` : null,
          rejectReason: shiftStatus === 'rejected' ? 'Cần kiểm tra lại số liệu NG ca này' : null,
        };
      });

      reports.push({
        id: reportId,
        date: dateStr,
        machineId: machine.id,
        machineName: machine.name,
        line: machine.line,
        dept: machine.dept,
        shifts: shiftData,
        status,
        createdBy: shiftData[0].operatorId,
        createdAt: `${dateStr}T08:00:00`,
        submittedAt: status !== 'draft' ? `${dateStr}T22:00:00` : null,
        approvedByLeader: ['leader_approved', 'chief_approved'].includes(status) ? shiftData[0].leaderId : null,
        approvedByLeaderAt: ['leader_approved', 'chief_approved'].includes(status) ? `${dateStr}T22:30:00` : null,
        approvedByChief: status === 'chief_approved' ? 'AC001' : null,
        approvedByChiefAt: status === 'chief_approved' ? `${dateStr}T23:00:00` : null,
        rejectReason: status === 'rejected' ? 'Cần kiểm tra lại số liệu NG ca 2' : null,
        ifsSynced: status === 'chief_approved',
        ifsSyncedAt: status === 'chief_approved' ? `${dateStr}T23:15:00` : null,
      });
    });
  }

  return reports.sort((a, b) => b.date.localeCompare(a.date) || a.machineId.localeCompare(b.machineId));
};

// ============================================================================
// MOCK MONTHLY PLAN (BM-01)
// ============================================================================
// OT plan states:
//   'on'   → plan explicitly enables OT (overrides global setting)
//   'off'  → plan explicitly disables OT (overrides global setting)
//   null   → plan does not specify; fall back to global setting (Ast/Chief)
// Priority rule: plan > global setting.
const generateMonthlyPlan = (year, month) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const plans = [];

  // Deterministic plan based on ROUTING (CNC_Flow.pdf).
  // Each routing entry = 1 product × 1 operation on a machine → 1 plan row.
  ROUTING.forEach(route => {
    const product = findProductByCode(route.productCode);
    if (!product) return;
    const dailyPlans = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const day = pad2(d);
      const dt = new Date(year, month - 1, d);
      const isSunday = dt.getDay() === 0;
      if (!isSunday) {
        const dailyQty = route.dailyQty;
        const s1 = Math.ceil(dailyQty / 3);
        const s2 = Math.ceil((dailyQty - s1) / 2);
        const s3 = dailyQty - s1 - s2;
        dailyPlans[day] = {
          plan: dailyQty,
          s1, s2, s3,
          actual: dailyQty,
          ngTest: 0,
          ngOther: 0,
          otOverride: null,
          otPlannedMinutes: 0,
        };
      }
    }
    plans.push({
      machineId: route.machineId,
      productCode: product.code,
      productName_vi: `${product.name_vi} — ${route.operation}`,
      productName_ja: `${product.name_ja} — ${route.operationJa}`,
      operationName: route.operation,
      _step: route.step,
      keyIFS: product.keyIFS,
      docCode: product.docCode,
      ct: product.ct,
      csCoDelivery: route.dailyQty * 20,
      csActualDelivery: route.dailyQty * 18,
      nextProcessPlan: route.dailyQty * 20,
      nextProcessActual: route.dailyQty * 18,
      mrpStart: `${year}-${pad2(month)}-01`,
      mrpEnd: `${year}-${pad2(month)}-${pad2(daysInMonth)}`,
      dailyPlans,
    });
  });
  return plans;
};

// Resolve OT visibility/config for a machine on a specific date, given global setting.
// Returns: { visible: boolean, plannedMinutes: number, source: 'plan-on'|'plan-off'|'setting-on'|'setting-off' }
const resolveOtForDay = (plans, machineId, dateStr, globalOtEnabled) => {
  const machinePlan = plans.find(p => p.machineId === machineId);
  const day = dateStr.split('-')[2];
  const dp = machinePlan?.dailyPlans?.[day];
  if (dp && dp.otOverride === 'on') {
    return { visible: true, plannedMinutes: dp.otPlannedMinutes || 0, source: 'plan-on' };
  }
  if (dp && dp.otOverride === 'off') {
    return { visible: false, plannedMinutes: 0, source: 'plan-off' };
  }
  // Plan doesn't specify → fall back to global setting
  return {
    visible: !!globalOtEnabled,
    plannedMinutes: 0,
    source: globalOtEnabled ? 'setting-on' : 'setting-off',
  };
};
// ============================================================================
// HELPER LOOKUPS (name resolution by lang)
// ============================================================================
const getProductName = (code, lang) => {
  const p = products.find(x => x.code === code);
  return p ? p[`name_${lang}`] : code;
};
const getDowntimeReasonName = (id, lang) => {
  const r = downtimeReasons.find(x => x.id === id);
  return r ? r[`name_${lang}`] : '';
};
const getNGReasonName = (id, lang) => {
  const r = ngReasons.find(x => x.id === id);
  return r ? r[`name_${lang}`] : '';
};
const getRootCauseName = (id, lang) => {
  const r = rootCauses.find(x => x.id === id);
  return r ? r[`name_${lang}`] : '';
};
const getCounterName = (id, lang) => {
  const r = countermeasures.find(x => x.id === id);
  return r ? r[`name_${lang}`] : '';
};
const getMachineById = (id) => machines.find(m => m.id === id);

const getStatusColor = (status) => {
  const map = {
    draft: 'bg-gray-100 text-gray-700 border-gray-300',
    submitted: 'bg-blue-100 text-blue-700 border-blue-300',
    leader_approved: 'bg-amber-100 text-amber-700 border-amber-300',
    chief_approved: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    rejected: 'bg-rose-100 text-rose-700 border-rose-300',
  };
  return map[status] || 'bg-gray-100 text-gray-700 border-gray-300';
};

const getStatusLabel = (status, t) => {
  const map = {
    draft: t.draft,
    submitted: t.submitted,
    leader_approved: t.leaderApproved,
    chief_approved: t.chiefApproved,
    rejected: t.rejected,
  };
  return map[status] || status;
};

// Calculate summary for a report
const calcReportSummary = (report) => {
  let totalPlan = 0, totalOK = 0, totalNGTest = 0, totalNG = 0, totalNGPending = 0, totalDowntime = 0;
  report.shifts?.forEach(sh => {
    sh.productEntries?.forEach(pe => {
      totalPlan += pe.planQty || 0;
      totalOK += pe.okCount || 0;
      totalNGTest += pe.ngTest || 0;
      totalNGPending += pe.ngPending || 0;
      // Calculate NG from defectEntries (new model) or fall back to ng field (old model)
      const peDefectNG = (pe.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
      totalNG += peDefectNG || (pe.ng || 0);
    });
    sh.downtimeEntries?.forEach(de => {
      totalDowntime += de.minutes || 0;
    });
  });
  const totalNGAll = totalNGTest + totalNG + totalNGPending;
  const totalProduced = totalOK + totalNGAll;
  const achievement = totalPlan > 0 ? Math.round((totalOK / totalPlan) * 100) : 0;
  const defectRate = totalProduced > 0 ? ((totalNGAll / totalProduced) * 100).toFixed(2) : '0.00';
  return { totalPlan, totalOK, totalNGTest, totalNG, totalNGPending, totalNGAll, totalProduced, totalDowntime, achievement, defectRate };
};

// ============================================================================
// ABNORMALITY DETECTION for bulk approval
// ============================================================================
// A report is "abnormal" when any of the following rules trigger. Reports with
// BLOCKING flags (ngHigh, otNoReason) cannot be bulk-approved — the manager
// must open them individually. Non-blocking flags (downtimeLong, overtime) are
// shown as warnings but still allow bulk approval.
//
//   Flag           Rule                                  Blocking?
//   ngHigh         NG / (OK + NG) > 5%                   YES
//   otNoReason     any OT entry with missing reasonId    YES
//   downtimeLong   total downtime > 60 minutes           no (warning)
//   overtime       any OT entry with minutes > 0         no (warning)
//
// Thresholds are intentionally simple for the demo — in production these would
// be configurable per line / per product family.
const NG_THRESHOLD_PERCENT = 5; // > 5% NG rate flags as abnormal
const DOWNTIME_THRESHOLD_MIN = 60; // > 60 min total downtime = abnormal
const getReportAbnormalities = (report) => {
  const flags = [];
  const s = calcReportSummary(report);
  const ngRate = s.totalProduced > 0 ? (s.totalNGAll / s.totalProduced) * 100 : 0;
  if (ngRate > NG_THRESHOLD_PERCENT) flags.push({ type: 'ngHigh', blocking: true });
  if (s.totalDowntime > DOWNTIME_THRESHOLD_MIN) flags.push({ type: 'downtimeLong', blocking: false });
  let hasOt = false;
  let otMissingReason = false;
  (report.shifts || []).forEach(sh => {
    (sh.overtimeEntries || []).forEach(ot => {
      if ((ot.minutes || 0) > 0) {
        hasOt = true;
        if (!ot.reasonId) otMissingReason = true;
      }
    });
  });
  if (hasOt) flags.push({ type: 'overtime', blocking: false });
  if (otMissingReason) flags.push({ type: 'otNoReason', blocking: true });
  return flags;
};
const isReportAbnormal = (report) => getReportAbnormalities(report).length > 0;
const canBulkApproveReport = (report) =>
  !getReportAbnormalities(report).some(f => f.blocking);
// ============================================================================
// UI: LOGIN SCREEN
// Two-tier tab selector:
//   Row 1 (primary tabs) — department teams: Press / CNC / Mill / Management
//   Row 2 (shift sub-tabs, only visible on team tabs) — Ca 1 / Ca 2 / Ca 3
// Each shift shows the 5-person team (1 Sub Leader + 4 Operators).
// Management tab lists Ast Chief, Chief, QA, Maintenance, and Director.
// ============================================================================
// FCC factory: 1 bộ phận duy nhất — tab dept đóng vai trò hiển thị, không cần chuyển
const DEPT_TABS = [
  { key: 'Gia công CNC', labelKey: 'deptCNC', color: 'bg-emerald-500', accent: 'border-emerald-500 text-emerald-700 bg-emerald-50', icon: Settings },
];

const MGMT_ROLE_COLORS = {
  section_manager: 'bg-purple-500',
  qa: 'bg-emerald-500',
  maintenance: 'bg-orange-500',
  director: 'bg-rose-500',
};

const LoginScreen = ({ onLogin, lang, setLang, t, activeTab, setActiveTab, activeShift, setActiveShift }) => {

  const isMgmt = activeTab === '__mgmt__';

  const teamUsers = useMemo(() => {
    if (isMgmt) return [];
    // Return users for (activeTab dept, activeShift). Sub Leader first, then operators.
    const subLead = mockUsers.find(u => u.role === 'team_leader' && u.dept === activeTab && u.shiftNumber === activeShift);
    const ops = mockUsers.filter(u => u.role === 'operator' && u.dept === activeTab && u.shiftNumber === activeShift);
    return [subLead, ...ops].filter(Boolean);
  }, [activeTab, activeShift, isMgmt]);

  const mgmtGroups = useMemo(() => {
    if (!isMgmt) return [];
    return [
      { role: 'section_manager', label: t.sectionManager, users: mockUsers.filter(u => u.role === 'section_manager') },
      { role: 'qa',              label: t.qa,             users: mockUsers.filter(u => u.role === 'qa') },
      { role: 'maintenance',     label: t.maintenance,    users: mockUsers.filter(u => u.role === 'maintenance') },
      { role: 'director',        label: t.director,       users: mockUsers.filter(u => u.role === 'director') },
    ];
  }, [isMgmt, t]);

  const activeDept = DEPT_TABS.find(d => d.key === activeTab);
  const deptColor = activeDept?.color || 'bg-slate-500';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-2xl mb-4">
            <Factory className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-white">{t.appTitle}</h1>
          <p className="text-blue-200 mt-1">{t.appSubtitle}</p>
          <p className="text-xs text-blue-300 mt-1">{t.companyName}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h2 className="text-lg font-semibold text-slate-800">{t.selectTeam}</h2>
            <button
              onClick={() => setLang(lang === 'vi' ? 'ja' : 'vi')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm text-slate-700"
            >
              <Globe className="w-4 h-4" /> {lang === 'vi' ? '日本語' : 'Tiếng Việt'}
            </button>
          </div>

          {/* Primary tabs — departments + management */}
          <div className="flex gap-1 px-6 border-b border-slate-200 overflow-x-auto">
            {DEPT_TABS.map(tab => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                    active
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${tab.color}`}></span>
                  {t[tab.labelKey] || tab.key}
                </button>
              );
            })}
            <button
              onClick={() => setActiveTab('__mgmt__')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ml-auto ${
                isMgmt
                  ? 'border-purple-600 text-purple-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Users className="w-4 h-4" /> {t.managementTab}
            </button>
          </div>

          {/* Shared content area — fixed height so tabs don't jump */}
          <div className="px-6 pt-4 pb-5" style={{ minHeight: '340px' }}>
            {/* Shift sub-tabs — only for team tabs */}
            {!isMgmt && (
              <div className="flex gap-2 mb-4">
                {[1, 2, 3].map(sh => {
                  const active = activeShift === sh;
                  return (
                    <button
                      key={sh}
                      onClick={() => setActiveShift(sh)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition ${
                        active
                          ? `${deptColor} text-white border-transparent shadow-sm`
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {t[`shift${sh}`] || `Ca ${sh}`}
                    </button>
                  );
                })}
                <div className="flex-1"></div>
                <div className="flex items-center text-xs text-slate-500">
                  {t.teamSize}: <span className="ml-1 font-semibold text-slate-700">{teamUsers.length} {t.people}</span>
                </div>
              </div>
            )}

            {/* User grid — shared scroll area */}
            <div className="max-h-[50vh] overflow-y-auto">
              {!isMgmt && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {teamUsers.map(u => {
                    const isLeader = u.role === 'team_leader';
                    return (
                      <button
                        key={u.id}
                        onClick={() => onLogin(u)}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition ${
                          isLeader
                            ? 'border-indigo-300 bg-indigo-50 hover:border-indigo-500 hover:bg-indigo-100'
                            : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full ${isLeader ? 'bg-indigo-500' : deptColor} text-white flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                          {u.name.split(' ').pop().charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="text-sm font-semibold text-slate-800 truncate">{u.name}</div>
                            {isLeader && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-500 text-white text-[9px] font-bold flex-shrink-0">SL</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {u.roleLabel}
                            {u.machineId ? ` · ${getMachineById(u.machineId)?.name || u.machineId}` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {isMgmt && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {mgmtGroups.flatMap(group => group.users.map(u => (
                    <button
                      key={u.id}
                      onClick={() => onLogin(u)}
                      className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 hover:border-purple-400 hover:bg-purple-50 text-left transition"
                    >
                      <div className={`w-10 h-10 rounded-full ${MGMT_ROLE_COLORS[u.role] || 'bg-purple-500'} text-white flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                        {u.name.split(' ').pop().charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <div className="text-sm font-semibold text-slate-800 truncate">{u.name}</div>
                          <span className={`px-1.5 py-0.5 rounded text-white text-[9px] font-bold flex-shrink-0 ${MGMT_ROLE_COLORS[u.role] || 'bg-purple-500'}`}>
                            {(u.roleLabel || u.role || '').split(' ')[0]}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 truncate">{u.roleLabel || u.role} · {u.dept || ''}</div>
                      </div>
                    </button>
                  )))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: SIDEBAR
// ============================================================================
const Sidebar = ({ user, currentPage, setCurrentPage, onLogout, t, collapsed, setCollapsed }) => {
  // Only Sub Leader and Chief/Ast Chief see the approvals page
  const canApprove = user.role === 'team_leader' || user.role === 'section_manager';
  const navItems = [
    { key: 'dashboard', label: t.dashboard, icon: Home },
    { key: 'reports', label: t.reports, icon: FileText },
    { key: 'monthlyPlan', label: t.monthlyPlan, icon: Calendar },
    ...(canApprove ? [{ key: 'approvals', label: t.approvals, icon: UserCheck, badge: true }] : []),
    { key: 'analytics', label: t.analytics, icon: BarChart3 },
    { key: 'ifs', label: t.ifsIntegration, icon: Database },
    { key: 'settings', label: t.settings, icon: Settings },
  ];

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col transition-all duration-200`}>
      <div className="p-4 border-b border-slate-700 flex items-center gap-2">
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0 hover:bg-blue-500 transition" title={t.appTitle}>
            <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <>
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <Factory className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">FCC Vietnam</div>
              <div className="text-xs text-slate-400 truncate">Smart Factory</div>
            </div>
            <button onClick={() => setCollapsed(true)} className="p-1 hover:bg-slate-700 rounded">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = currentPage === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setCurrentPage(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-700">
        {!collapsed && (
          <div className="mb-2 px-2">
            <div className="text-sm font-medium truncate">{user.name}</div>
            <div className="text-xs text-slate-400 truncate">{user.roleLabel}</div>
            {user.machineId && <div className="text-xs text-blue-400 truncate">{user.machineId}</div>}
          </div>
        )}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-rose-600 hover:text-white transition"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>{t.logout}</span>}
        </button>
      </div>
    </aside>
  );
};

// ============================================================================
// UI: TOP BAR
// ============================================================================
const TopBar = ({ user, lang, setLang, t }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-black shadow-md">
          FCC
        </div>
        <div>
          <div className="text-sm font-bold text-slate-800 leading-tight">FCC Vietnam · Smart Factory</div>
          <div className="text-xs text-slate-500">{now.toLocaleString(lang === 'vi' ? 'vi-VN' : 'ja-JP')}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
          {t.ifsConnected}
        </div>
        <button
          onClick={() => setLang(lang === 'vi' ? 'ja' : 'vi')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm text-slate-700"
        >
          <Globe className="w-4 h-4" /> {lang === 'vi' ? '日本語' : 'VN'}
        </button>
        <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
            {user.name.split(' ').pop().charAt(0)}
          </div>
          <div className="hidden md:block">
            <div className="text-sm font-medium text-slate-800">{user.name}</div>
            <div className="text-xs text-slate-500">{user.roleLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
};

// ============================================================================
// UI: PAGE SHELL (sticky page title, stays fixed when TopBar scrolls away)
// ============================================================================
const PageShell = ({ title, subtitle, icon: Icon, actions, children }) => (
  <>
    <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-800 truncate">{title}</h1>
          {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
    {children}
  </>
);

// ============================================================================
// UI: SHIFT STATUS DOT — compact per-shift status for report list
// ============================================================================
const ShiftStatusDot = ({ status, t }) => {
  const cfg = {
    draft:            { label: 'Nháp',     bg: 'bg-slate-100',  text: 'text-slate-500',  border: 'border-slate-200' },
    submitted:        { label: 'Đã gửi',   bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200' },
    leader_approved:  { label: 'Duyệt',    bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    chief_approved:   { label: 'Chief',     bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200' },
    rejected:         { label: 'Từ chối',   bg: 'bg-rose-50',    text: 'text-rose-700',   border: 'border-rose-200' },
  };
  const c = cfg[status] || cfg.draft;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${c.bg} ${c.text} ${c.border} whitespace-nowrap`}>
      {c.label}
    </span>
  );
};

// ============================================================================
// UI: STATUS BADGE
// ============================================================================
const StatusBadge = ({ status, t, report, user }) => {
  // ── Context-aware status display ──
  // Operator/Leader: thấy status shift của mình → nếu leader đã duyệt shift → "Leader đã duyệt"
  // Chief/Manager/Director: thấy report-level status + progress (e.g. "Leader duyệt (1/3)")
  let displayStatus = status;
  let progressLabel = null;

  const isOperatorOrLeader = user && (user.role === 'operator' || user.role === 'team_leader');
  const isChiefLevel = user && (user.role === 'section_manager' || user.role === 'director');

  if (report?.shifts) {
    const approvedCount = report.shifts.filter(s => s.status === 'leader_approved').length;
    const total = report.shifts.length;

    if (isOperatorOrLeader && user.shiftNumber) {
      // Tìm shift của user (user.shiftNumber = 1/2/3)
      const myShift = report.shifts.find(s => s.shiftNumber === user.shiftNumber);
      if (myShift) {
        // Hiển thị status shift của user, không phải report-level
        displayStatus = myShift.status || status;
      }
    } else if (isChiefLevel) {
      // Chief view: report-level status + progress indicator
      if (status === 'submitted' || (status === 'leader_approved' && approvedCount < total)) {
        // Chưa đủ leader duyệt → hiển thị progress
        if (approvedCount > 0) {
          displayStatus = 'leader_approved';
          progressLabel = `${approvedCount}/${total}`;
        } else {
          displayStatus = 'submitted';
        }
      }
    } else {
      // Default (no user info): report-level with progress
      if (status === 'submitted' && approvedCount > 0) {
        progressLabel = `${approvedCount}/${total}`;
      }
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(displayStatus)}`}>
      {getStatusLabel(displayStatus, t)}
      {progressLabel && <span className="ml-0.5 opacity-75">({progressLabel})</span>}
    </span>
  );
};

// ============================================================================
// UI: SELECT MODAL (for quick pick)
// ============================================================================
const ModalSelect = ({ open, title, options, onSelect, onClose, lang }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full max-h-[80vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto max-h-[60vh] p-2">
          {options.map(opt => (
            <button
              key={opt.id || opt.code || opt.value}
              onClick={() => { onSelect(opt); onClose(); }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition"
            >
              <div className="font-medium text-slate-800">{opt[`name_${lang}`] || opt.name || opt.label}</div>
              {opt.sub && <div className="text-xs text-slate-500">{opt.sub}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: CONFIRM DIALOG
// ============================================================================
const ConfirmDialog = ({ open, title, message, onConfirm, onCancel, t }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full shadow-2xl">
        <div className="p-5">
          <h3 className="font-semibold text-lg text-slate-800 mb-2">{title}</h3>
          <p className="text-sm text-slate-600">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 bg-slate-50 rounded-b-xl">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-100">{t.cancel}</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">{t.confirm}</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: NUMBER INPUT (tablet-friendly, with +/- quick buttons and clear-on-type)
// ============================================================================
// ============================================================================
// UI: NUMBER WHEEL PICKER MODAL (iOS-style drum wheel for tablets)
// ============================================================================
// Tap a number field → modal opens with 3 independent drum wheels for digits
// (hundreds, tens, units). Drag vertically to spin each wheel.
// ============================================================================
const DrumWheel = ({ value, onChange, digits, label, tone = 'blue' }) => {
  // Single drum — digits 0..9. Current value shown in center, neighbors faded.
  const itemH = 52;
  const containerRef = useRef(null);
  const dragStartY = useRef(null);
  const dragStartVal = useRef(value);

  const wrap = (v) => ((v % 10) + 10) % 10;

  const renderItems = () => {
    // Show -2 .. +2 around current value
    return [-2, -1, 0, 1, 2].map(off => {
      const n = wrap(value + off);
      const opacity = off === 0 ? 1 : off === -1 || off === 1 ? 0.55 : 0.22;
      const scale = off === 0 ? 1 : 0.85;
      const weight = off === 0 ? 'font-black' : 'font-semibold';
      return (
        <div
          key={off}
          className={`flex items-center justify-center select-none pointer-events-none text-3xl ${weight} tabular-nums transition-all`}
          style={{ height: itemH, opacity, transform: `scale(${scale})` }}
        >
          {n}
        </div>
      );
    });
  };

  const onPointerDown = (e) => {
    dragStartY.current = e.clientY;
    dragStartVal.current = value;
    containerRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (dragStartY.current == null) return;
    const dy = dragStartY.current - e.clientY; // dragging up → increase
    const delta = Math.round(dy / (itemH / 2));
    if (delta !== 0) {
      const next = wrap(dragStartVal.current + delta);
      if (next !== value) onChange(next);
    }
  };
  const onPointerUp = (e) => {
    dragStartY.current = null;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    onChange(wrap(value + dir));
  };

  const toneRing = tone === 'emerald' ? 'ring-emerald-400 text-emerald-900'
    : tone === 'rose' ? 'ring-rose-400 text-rose-900'
    : tone === 'amber' ? 'ring-amber-400 text-amber-900'
    : 'ring-blue-400 text-blue-900';

  return (
    <div className="flex flex-col items-center">
      {label && <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => onChange(wrap(value - 1))}
          className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 flex items-center justify-center mr-1"
          tabIndex={-1}
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          className={`relative w-14 rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden touch-none cursor-grab active:cursor-grabbing`}
          style={{ height: itemH * 5 }}
        >
          {/* Highlight band for center row */}
          <div
            className={`absolute left-0 right-0 bg-white ring-2 ${toneRing} rounded-lg pointer-events-none`}
            style={{ top: itemH * 2, height: itemH }}
          />
          <div className="flex flex-col">{renderItems()}</div>
        </div>
        <button
          type="button"
          onClick={() => onChange(wrap(value + 1))}
          className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 flex items-center justify-center ml-1"
          tabIndex={-1}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// Single scrollable wheel showing the current number with neighbors (not split by digit).
// Range is clamped by [min, max]. Drag vertically or use mouse-wheel / arrow buttons.
const SingleNumberWheel = ({ value, onChange, min = 0, max = 9999, tone = 'blue' }) => {
  const itemH = 56;
  const containerRef = useRef(null);
  const dragStartY = useRef(null);
  const dragStartVal = useRef(value);

  const clamp = (v) => Math.max(min, Math.min(max, v));

  const onPointerDown = (e) => {
    dragStartY.current = e.clientY;
    dragStartVal.current = value;
    containerRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (dragStartY.current == null) return;
    const dy = dragStartY.current - e.clientY;
    const delta = Math.round(dy / (itemH / 2));
    if (delta !== 0) {
      const next = clamp(dragStartVal.current + delta);
      if (next !== value) onChange(next);
    }
  };
  const onPointerUp = (e) => {
    dragStartY.current = null;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    onChange(clamp(value + dir));
  };

  const toneRing =
    tone === 'emerald' ? 'ring-emerald-400 text-emerald-900'
    : tone === 'rose' ? 'ring-rose-400 text-rose-900'
    : tone === 'amber' ? 'ring-amber-400 text-amber-900'
    : 'ring-blue-400 text-blue-900';

  const rows = [-2, -1, 0, 1, 2].map(off => {
    const n = value + off;
    const valid = n >= min && n <= max;
    const opacity = off === 0 ? 1 : off === -1 || off === 1 ? 0.55 : 0.22;
    const scale = off === 0 ? 1 : 0.82;
    const weight = off === 0 ? 'font-black' : 'font-semibold';
    return (
      <div
        key={off}
        className={`flex items-center justify-center select-none pointer-events-none text-4xl ${weight} tabular-nums transition-all`}
        style={{ height: itemH, opacity: valid ? opacity : 0.08, transform: `scale(${scale})` }}
      >
        {valid ? n : ''}
      </div>
    );
  });

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 flex items-center justify-center"
        tabIndex={-1}
      >
        <ChevronUp className="w-5 h-5" />
      </button>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className={`relative w-40 rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden touch-none cursor-grab active:cursor-grabbing`}
        style={{ height: itemH * 5 }}
      >
        <div
          className={`absolute left-0 right-0 bg-white ring-2 ${toneRing} rounded-lg pointer-events-none`}
          style={{ top: itemH * 2, height: itemH }}
        />
        <div className="flex flex-col">{rows}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 flex items-center justify-center"
        tabIndex={-1}
      >
        <ChevronDown className="w-5 h-5" />
      </button>
    </div>
  );
};

const NumberWheelModal = ({ open, value, onSelect, onClose, title, tone = 'default', lang = 'vi', t: tProp }) => {
  const t = tProp || translations[lang];
  const initial = Math.max(0, parseInt(value ?? 0, 10) || 0);
  const [current, setCurrent] = useState(initial);

  useEffect(() => {
    if (open) setCurrent(Math.max(0, parseInt(value ?? 0, 10) || 0));
  }, [open, value]);

  if (!open) return null;

  const MAX = 99999;
  const clamp = (v) => Math.max(0, Math.min(MAX, v));
  const bump = (delta) => setCurrent(clamp(current + delta));
  const reset = () => setCurrent(0);

  const confirm = () => {
    onSelect(current);
    onClose();
  };

  const toneMap = {
    default: 'from-blue-600 to-indigo-600',
    ok: 'from-emerald-600 to-teal-600',
    warn: 'from-amber-500 to-orange-600',
    ng: 'from-rose-600 to-red-600',
  };
  const wheelTone = tone === 'ok' ? 'emerald' : tone === 'warn' ? 'amber' : tone === 'ng' ? 'rose' : 'blue';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header — colored by tone */}
        <div className={`bg-gradient-to-r ${toneMap[tone] || toneMap.default} text-white p-5`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold opacity-90">{title || t.numberPickerTitle}</div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-center text-6xl font-black tabular-nums mt-3">
            {current}
          </div>
        </div>

        {/* Single wheel */}
        <div className="p-5 bg-slate-50">
          <SingleNumberWheel value={current} onChange={setCurrent} min={0} max={MAX} tone={wheelTone} />
          <div className="text-[10px] text-center text-slate-500 mt-3 italic">
            {t.pickerHint}
          </div>
        </div>

        {/* Quick action buttons — row 1: ±10 / ±5 */}
        <div className="px-5 pb-2 grid grid-cols-4 gap-2">
          <button onClick={() => bump(-10)} className="py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100">−10</button>
          <button onClick={() => bump(-5)} className="py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100">−5</button>
          <button onClick={() => bump(+5)} className="py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100">+5</button>
          <button onClick={() => bump(+10)} className="py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-100">+10</button>
        </div>
        {/* Row 2: ±1 / reset */}
        <div className="px-5 pb-3 grid grid-cols-3 gap-2">
          <button onClick={() => bump(-1)} className="py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100">−1</button>
          <button onClick={reset} className="py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100">{t.reset}</button>
          <button onClick={() => bump(+1)} className="py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100">+1</button>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 p-4 bg-slate-50 border-t border-slate-200">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100">
            {t.cancel}
          </button>
          <button onClick={confirm} className={`px-6 py-2.5 rounded-xl bg-gradient-to-r ${toneMap[tone] || toneMap.default} text-white text-sm font-bold shadow-md hover:opacity-95`}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

const NumberInputTablet = ({ value, onChange, step = 1, min = 0, className = '', tone = 'default', readOnly = false, label, error = false, lang = 'vi' }) => {
  const [modalOpen, setModalOpen] = useState(false);

  const toneMap = {
    default: 'bg-white border-slate-300 text-slate-900 hover:border-blue-400',
    ok: 'bg-emerald-50 border-emerald-300 text-emerald-900 hover:border-emerald-500',
    warn: 'bg-amber-50 border-amber-300 text-amber-900 hover:border-amber-500',
    ng: 'bg-rose-50 border-rose-300 text-rose-900 hover:border-rose-500',
    plan: 'bg-slate-100 border-slate-300 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-300 text-emerald-900 hover:border-emerald-500',
    rose: 'bg-rose-50 border-rose-300 text-rose-900 hover:border-rose-500',
  };

  if (readOnly) {
    return (
      <div className={className}>
        {label && <label className="text-xs text-slate-500 block mb-1">{label}</label>}
        <div className={`px-3 py-3 rounded-xl border-2 text-center text-lg font-bold ${toneMap.plan} flex items-center justify-center gap-2`}>
          <Lock className="w-3.5 h-3.5 text-slate-400" /> {value ?? 0}
        </div>
      </div>
    );
  }

  const errorClasses = 'bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-300 hover:border-rose-600';

  return (
    <div className={className}>
      {label && <label className={`text-xs block mb-1 ${error ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{label}{error && ' *'}</label>}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={`w-full px-3 py-3 rounded-xl border-2 text-center text-xl font-black tabular-nums ${error ? errorClasses : (toneMap[tone] || toneMap.default)} transition active:scale-95 cursor-pointer`}
      >
        {value ?? 0}
      </button>
      <NumberWheelModal
        open={modalOpen}
        value={value}
        onSelect={(v) => onChange(Math.max(min, v))}
        onClose={() => setModalOpen(false)}
        title={label}
        tone={tone === 'plan' ? 'default' : tone}
        lang={lang}
      />
    </div>
  );
};

// ============================================================================
// UI: TIME PICKER MODAL — Analog clock face with draggable hour/minute hand
// ============================================================================
// Material-Design-style clock picker:
//   1. Mode 'hour' — hour numbers arranged around a 24h ring (0–11 outer, 12–23 inner)
//   2. Mode 'minute' — minute numbers 00, 05, 10, …, 55 around a ring
// Click or drag the clock face to set the hand. Tapping a number also works.
// ============================================================================
const ClockFace = ({ mode, value, onChange }) => {
  // Geometry
  const size = 260;
  const center = size / 2;
  const outerRadius = 110;
  const innerRadius = 72; // used for 12-23 in hour mode
  const handRef = useRef(null);

  // Build number positions
  const buildNumbers = () => {
    if (mode === 'hour') {
      // 1..12 at outer ring (represent 1..12 and 13..0 pairs), plus 13..24 (=0) inner
      const outer = Array.from({ length: 12 }, (_, i) => {
        const num = i === 11 ? 12 : i + 1; // 1..12
        const angle = ((i + 1) * 30 - 90) * (Math.PI / 180);
        return { num: num === 12 ? 12 : num, display: pad2(num === 12 ? 12 : num), angle, r: outerRadius, ring: 'outer' };
      });
      // Inner ring: 13..24 (24 = 00)
      const inner = Array.from({ length: 12 }, (_, i) => {
        const num24 = i + 13; // 13..24
        const displayed = num24 === 24 ? 0 : num24;
        const angle = ((i + 1) * 30 - 90) * (Math.PI / 180);
        return { num: displayed, display: pad2(displayed), angle, r: innerRadius, ring: 'inner' };
      });
      return [...outer, ...inner];
    } else {
      // Minute mode: 0, 5, 10, ..., 55
      return Array.from({ length: 12 }, (_, i) => {
        const m = i * 5;
        const angle = (i * 30 - 90) * (Math.PI / 180);
        return { num: m, display: pad2(m), angle, r: outerRadius, ring: 'outer' };
      });
    }
  };
  const nums = buildNumbers();

  // Current hand angle & length
  const getHand = () => {
    if (mode === 'hour') {
      // 24h support: hours 1..12 → outer, 13..23,0 → inner (0 shown as 24 slot)
      const h = value;
      const slot = h === 0 ? 12 : h <= 12 ? h : h - 12;
      const angle = (slot * 30 - 90) * (Math.PI / 180);
      const r = (h === 0 || h >= 13) ? innerRadius : outerRadius;
      return { angle, r };
    } else {
      // Minute 0..59 — hand snaps to exact minute
      const angle = (value * 6 - 90) * (Math.PI / 180);
      return { angle, r: outerRadius };
    }
  };
  const hand = getHand();
  const handX = center + Math.cos(hand.angle) * hand.r;
  const handY = center + Math.sin(hand.angle) * hand.r;

  // Click/drag on the clock face — compute nearest slot
  const pickFromEvent = (clientX, clientY) => {
    const rect = handRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left - center;
    const y = clientY - rect.top - center;
    const dist = Math.sqrt(x * x + y * y);
    let angleDeg = Math.atan2(y, x) * (180 / Math.PI) + 90; // 0 = top
    if (angleDeg < 0) angleDeg += 360;

    if (mode === 'hour') {
      // Nearest of 12 hour slots. Determine ring.
      const slot = Math.round(angleDeg / 30) % 12; // 0..11 where 0=12 o'clock
      const isInner = dist < (outerRadius + innerRadius) / 2;
      if (isInner) {
        // Inner ring: maps to 13..23 and 0
        const num = slot === 0 ? 0 : slot + 12;
        onChange(num);
      } else {
        // Outer ring: maps to 1..12 (12 = 12)
        const num = slot === 0 ? 12 : slot;
        onChange(num);
      }
    } else {
      // Minute: 0..59 directly from angle
      const m = Math.round(angleDeg / 6) % 60;
      onChange(m);
    }
  };

  const isDragging = useRef(false);
  const onPointerDown = (e) => {
    isDragging.current = true;
    handRef.current?.setPointerCapture?.(e.pointerId);
    pickFromEvent(e.clientX, e.clientY);
  };
  const onPointerMove = (e) => {
    if (!isDragging.current) return;
    pickFromEvent(e.clientX, e.clientY);
  };
  const onPointerUp = (e) => {
    isDragging.current = false;
    handRef.current?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={handRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative mx-auto select-none touch-none"
      style={{ width: size, height: size }}
    >
      {/* Outer circle */}
      <div className="absolute inset-0 rounded-full bg-slate-100 border border-slate-200"></div>

      {/* Hand SVG */}
      <svg width={size} height={size} className="absolute inset-0 pointer-events-none">
        <line
          x1={center} y1={center}
          x2={handX} y2={handY}
          stroke="#2563eb"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={center} cy={center} r={6} fill="#2563eb" />
        <circle cx={handX} cy={handY} r={18} fill="#2563eb" fillOpacity={0.22} />
        <circle cx={handX} cy={handY} r={14} fill="#2563eb" />
      </svg>

      {/* Numbers */}
      {nums.map((n, i) => {
        const nx = center + Math.cos(n.angle) * n.r;
        const ny = center + Math.sin(n.angle) * n.r;
        const selected = (mode === 'hour' && n.num === value) || (mode === 'minute' && n.num === value);
        const fontSize = n.ring === 'inner' ? 11 : 14;
        return (
          <div
            key={i}
            className={`absolute pointer-events-none font-bold tabular-nums ${selected ? 'text-white' : n.ring === 'inner' ? 'text-slate-500' : 'text-slate-800'}`}
            style={{
              left: nx - 14,
              top: ny - 11,
              width: 28,
              textAlign: 'center',
              fontSize,
            }}
          >
            {n.display}
          </div>
        );
      })}
    </div>
  );
};

const TimePickerModal = ({ open, title, initial, onSelect, onClose, lang = 'vi', t: tProp }) => {
  const t = tProp || translations[lang];
  const [hour, setHour] = useState(() => (initial ? parseInt(initial.split(':')[0], 10) : 8));
  const [minute, setMinute] = useState(() => (initial ? parseInt(initial.split(':')[1], 10) : 0));
  const [mode, setMode] = useState('hour'); // 'hour' | 'minute'

  useEffect(() => {
    if (open) {
      if (initial) {
        setHour(parseInt(initial.split(':')[0], 10));
        setMinute(parseInt(initial.split(':')[1], 10));
      }
      setMode('hour');
    }
  }, [open, initial]);

  if (!open) return null;

  const confirm = () => {
    onSelect(`${pad2(hour)}:${pad2(minute)}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header — big HH:MM digits, click to toggle mode */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold opacity-90">{title || t.timePickerTitle}</div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-center gap-1 mt-3">
            <button
              onClick={() => setMode('hour')}
              className={`text-6xl font-black tabular-nums px-2 rounded-xl transition ${mode === 'hour' ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              {pad2(hour)}
            </button>
            <div className="text-6xl font-black text-white/70">:</div>
            <button
              onClick={() => setMode('minute')}
              className={`text-6xl font-black tabular-nums px-2 rounded-xl transition ${mode === 'minute' ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              {pad2(minute)}
            </button>
          </div>
          <div className="text-center text-xs text-white/70 mt-1">
            {mode === 'hour' ? t.hour : t.minute} · {mode === 'hour' ? t.hourPickerDesc : t.minPickerDesc}
          </div>
        </div>

        {/* Analog clock face */}
        <div className="p-5 bg-slate-50">
          <ClockFace
            mode={mode}
            value={mode === 'hour' ? hour : minute}
            onChange={(v) => {
              if (mode === 'hour') {
                setHour(v);
                // Auto switch to minute mode after picking hour
                setTimeout(() => setMode('minute'), 250);
              } else {
                setMinute(v);
              }
            }}
          />
          {/* Mode switch hint */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <button
              onClick={() => setMode('hour')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${mode === 'hour' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}
            >
              {t.hour}
            </button>
            <button
              onClick={() => setMode('minute')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${mode === 'minute' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}
            >
              {t.minute}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 bg-slate-50 border-t border-slate-200">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100">
            {t.cancel}
          </button>
          <button onClick={confirm} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold shadow-md hover:opacity-95">
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: REASON PICKER MODAL (tablet-friendly selection with big cards)
// ============================================================================
const ReasonPickerModal = ({ open, title, options, onSelect, onClose, lang, disabledIds = [], disabledLabel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 text-lg">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto max-h-[65vh] p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {options.map(opt => {
              const key = opt.id ?? opt.code;
              const disabled = disabledIds.includes(key);
              return (
                <button
                  key={key}
                  disabled={disabled}
                  onClick={() => { if (disabled) return; onSelect(opt); onClose(); }}
                  className={`text-left p-3 rounded-xl border-2 transition relative ${
                    disabled
                      ? 'border-slate-200 bg-slate-100 cursor-not-allowed opacity-50'
                      : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${disabled ? 'bg-slate-200 text-slate-500' : 'bg-blue-100 text-blue-700'}`}>
                      {String(key).substring(0, 3)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`font-semibold text-sm ${disabled ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{opt[`name_${lang}`] || opt.name}</div>
                      {disabled
                        ? <div className="text-[10px] text-rose-500 font-semibold mt-0.5">{disabledLabel || (lang === 'vi' ? 'Đã thêm rồi' : '既に追加済')}</div>
                        : (opt.sub && <div className="text-xs text-slate-500 truncate">{opt.sub}</div>)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: DASHBOARD (role-aware)
// ============================================================================
// ============================================================================
// ROLE-AWARE DASHBOARD DISPATCHER
// ============================================================================
const Dashboard = (props) => {
  const { user } = props;
  if (user.role === 'operator') return <OperatorDashboard {...props} />;
  if (user.role === 'team_leader') return <TeamLeaderDashboard {...props} />;
  if (user.role === 'section_manager') return <ChiefDashboard {...props} />;
  if (user.role === 'qa') return <QADashboard {...props} />;
  if (user.role === 'maintenance') return <MaintenanceDashboard {...props} />;
  if (user.role === 'director') return <DirectorDashboard {...props} />;
  return <OperatorDashboard {...props} />;
};

// ============================================================================
// KPI CARD HELPER
// ============================================================================
const KpiCard = ({ label, value, unit, Icon, tone = 'blue', sub }) => {
  const tones = {
    blue: 'text-blue-600 bg-blue-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    rose: 'text-rose-600 bg-rose-50',
    amber: 'text-amber-600 bg-amber-50',
    purple: 'text-purple-600 bg-purple-50',
  };
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-800 tabular-nums">{value}{unit && <span className="text-sm text-slate-500 ml-1">{unit}</span>}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
};

// ============================================================================
// DASHBOARD: OPERATOR (only own machine + own reports)
// ============================================================================
const OperatorDashboard = ({ user, reports, t, lang, onOpenReport, onNewReport }) => {
  const today = todayStr();
  const myReports = reports.filter(r => r.machineId === user.machineId);
  // ★ Chỉ coi là "có báo cáo hôm nay" nếu report do user tạo/submit (không phải WO seed từ middleware)
  const myTodayReport = myReports.find(r => r.date === today && !r._fromWO);
  const myRecent = myReports.slice(0, 10);

  // ★ Kiểm tra user đã report ca hôm nay chưa → disable nút nếu đã submit/approved
  const myShiftIdx = (user.shiftNumber || 1) - 1;
  const myShiftInReport = myTodayReport?.shifts?.[myShiftIdx];
  const alreadyReported = myShiftInReport && myShiftInReport.status && myShiftInReport.status !== 'draft';

  const myStats = useMemo(() => {
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const r = myReports.find(r => r.date === ds);
      if (r) {
        const s = calcReportSummary(r);
        last7.push({ date: ds.substring(5), plan: s.totalPlan, actual: s.totalOK, ng: s.totalNGAll });
      } else {
        last7.push({ date: ds.substring(5), plan: 0, actual: 0, ng: 0 });
      }
    }
    return last7;
  }, [myReports]);

  const todaySummary = myTodayReport ? calcReportSummary(myTodayReport) : null;

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      {/* Greeting */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-5 text-white flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-xs opacity-90 uppercase">{t.operator} · Dashboard</div>
          <div className="text-xl font-bold mt-1 truncate">{user.name}</div>
          <div className="text-sm opacity-90 mt-0.5 flex items-center gap-2">
            <Cog className="w-4 h-4" /> {user.machineId} · {user.line}
          </div>
        </div>
        <button
          onClick={onNewReport}
          disabled={alreadyReported}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shadow-lg ${alreadyReported ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-blue-700 hover:bg-blue-50 active:bg-blue-100'}`}
          title={alreadyReported ? (lang === 'vi' ? 'Bạn đã báo cáo ca này rồi' : 'このシフトは報告済みです') : ''}
        >
          <Plus className="w-5 h-5" /> {t.newReport}
        </button>
      </div>

      {/* Today status — simplified (no plan/NG details) */}
      {todaySummary ? (
        <div className="grid grid-cols-2 gap-4">
          <KpiCard label={t.todayReports} value={todaySummary.totalOK} unit={t.unit} Icon={CheckCircle} tone="emerald" />
          <KpiCard label={t.downtimeTotal} value={todaySummary.totalDowntime} unit={t.min} Icon={Clock} tone="amber" />
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-amber-900">{t.noReportToday}</div>
            <div className="text-xs text-amber-700 mt-0.5">{lang === 'vi' ? `Nhấn "${t.newReport}" để tạo báo cáo cho máy ${user.machineId}.` : `「${t.newReport}」を押して ${user.machineId} の報告を作成してください。`}</div>
          </div>
        </div>
      )}

      {/* 7-day trend */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-800 mb-3">{t.trend7Days} ({user.machineId})</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={myStats}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} />
            <Tooltip />
            <Area type="monotone" dataKey="actual" stroke="#10b981" fill="#a7f3d0" name="OK" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent reports — enlarged for clarity */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-slate-800 text-base">{t.myReports}</h3>
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">{myRecent.length}</span>
          </div>
          <span className="text-xs text-slate-500">10 {t.latest}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {myRecent.map(r => {
            return (
              <button key={r.id} onClick={() => onOpenReport(r)} className="w-full px-5 py-4 text-left hover:bg-blue-50/60 active:bg-blue-100 transition-colors flex items-center gap-4">
                {/* Left: Date block */}
                <div className="flex-shrink-0 w-16 text-center">
                  <div className="text-2xl font-black text-slate-800 leading-none">{r.date.split('-')[2]}</div>
                  <div className="text-[10px] uppercase text-slate-500 tracking-wide mt-1">{r.date.split('-')[1]}/{r.date.split('-')[0].slice(2)}</div>
                </div>

                {/* Middle: machine + line + status */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-slate-800">{r.machineId}</span>
                    <span className="text-xs text-slate-500">· {r.line}</span>
                  </div>
                  <div className="mt-1.5">
                    <StatusBadge status={r.status} t={t} report={r} user={user} />
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
              </button>
            );
          })}
          {myRecent.length === 0 && (
            <div className="p-10 text-center">
              <FileText className="w-12 h-12 text-slate-200 mx-auto mb-2" />
              <div className="text-sm text-slate-400">{t.noData}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// DASHBOARD: TEAM LEADER (own dept machines + approvals pending for me)
// ============================================================================
const TeamLeaderDashboard = ({ user, reports, t, lang, onOpenReport, onNewReport, setCurrentPage }) => {
  const isSubLeaderOperator = !!user.machineId && !!user.shiftNumber;
  const today = todayStr();
  // Filter to only reports from own dept
  const myDeptReports = reports.filter(r => r.dept === user.dept);
  const myDeptMachines = machines.filter(m => m.dept === user.dept);
  // A shift is "pending for me" if it is in submitted AND its shiftNumber
  // matches this Sub Leader's assigned shift. Each shift belongs to a different
  // Sub Leader, so Ca 1 leader only sees Ca 1 submissions, etc.
  const shiftMatchesMe = (sh) =>
    sh.status === 'submitted' &&
    (!user.shiftNumber || sh.shiftNumber === user.shiftNumber);
  const pending = myDeptReports.filter(r =>
    (r.shifts || []).some(shiftMatchesMe)
  );
  const pendingShiftsCount = myDeptReports.reduce(
    (sum, r) => sum + ((r.shifts || []).filter(shiftMatchesMe).length),
    0
  );
  const todayReports = myDeptReports.filter(r => r.date === today);

  // ★ Sub Leader cũng là operator → kiểm tra đã report ca chưa
  const myTodayReport = isSubLeaderOperator
    ? todayReports.find(r => r.machineId === user.machineId)
    : null;
  const myShiftIdx = (user.shiftNumber || 1) - 1;
  const myShiftInReport = myTodayReport?.shifts?.[myShiftIdx];
  const slAlreadyReported = isSubLeaderOperator && myShiftInReport && myShiftInReport.status && myShiftInReport.status !== 'draft';

  const deptStats = useMemo(() => {
    let plan = 0, ok = 0, ng = 0, dt = 0;
    todayReports.forEach(r => {
      const s = calcReportSummary(r);
      plan += s.totalPlan; ok += s.totalOK; ng += s.totalNGAll; dt += s.totalDowntime;
    });
    return {
      plan, ok, ng, dt,
      ach: plan > 0 ? Math.round((ok / plan) * 100) : 0,
      defect: (ok + ng) > 0 ? ((ng / (ok + ng)) * 100).toFixed(2) : '0.00',
    };
  }, [todayReports]);

  // Per-machine bar chart
  const byMachine = useMemo(() => myDeptMachines.map(m => {
    const r = todayReports.find(r => r.machineId === m.id);
    if (!r) return { name: m.id, plan: 0, actual: 0, ng: 0 };
    const s = calcReportSummary(r);
    return { name: m.id, plan: s.totalPlan, actual: s.totalOK, ng: s.totalNGAll };
  }), [todayReports, myDeptMachines]);

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-5 text-white flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs opacity-90 uppercase">Sub Leader · {user.dept}</div>
          <div className="text-xl font-bold mt-1">{user.name}</div>
          <div className="text-sm opacity-90 mt-0.5">
            {myDeptMachines.length} {t.machine} · {user.line}
            {isSubLeaderOperator && ` · ${user.machineId} · ${t[`shift${user.shiftNumber}`] || `Ca ${user.shiftNumber}`}`}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSubLeaderOperator && onNewReport && (
            <button
              onClick={onNewReport}
              disabled={slAlreadyReported}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shadow-lg ${slAlreadyReported ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-indigo-700 hover:bg-indigo-50 active:bg-indigo-100'}`}
              title={slAlreadyReported ? (lang === 'vi' ? 'Bạn đã báo cáo ca này rồi' : 'このシフトは報告済みです') : ''}
            >
              <Plus className="w-5 h-5" /> {t.newReport}
            </button>
          )}
          {pendingShiftsCount > 0 && (
            <button onClick={() => setCurrentPage?.('approvals')} className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white text-indigo-700 hover:bg-indigo-50 font-semibold text-sm shadow-lg">
              <UserCheck className="w-5 h-5" /> {pendingShiftsCount} {t.pendingShiftsTag}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KpiCard label={t.todayReports} value={`${todayReports.length}/${myDeptMachines.length}`} Icon={FileText} tone="blue" />
        <KpiCard label={t.needsConfirmation} value={pendingShiftsCount} Icon={ClipboardList} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.byMachine} ({user.dept})</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byMachine}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip />
              <Bar dataKey="actual" fill="#10b981" name="OK" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.needsConfirmation}</h3>
          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {(() => {
              // Flatten to a list of individual shifts waiting for leader approval.
              // Scope to this Sub Leader's own shift number only.
              const rows = [];
              myDeptReports.forEach(r => {
                (r.shifts || []).forEach((sh, si) => {
                  if (shiftMatchesMe(sh)) {
                    rows.push({ report: r, shift: sh, shiftIdx: si });
                  }
                });
              });
              return rows.slice(0, 8).map(({ report: r, shift: sh, shiftIdx }) => {
                return (
                  <button key={`${r.id}-s${shiftIdx}`} onClick={() => onOpenReport(r)} className="w-full text-left p-3 rounded-xl border-2 border-amber-200 bg-amber-50 hover:border-amber-400 active:bg-amber-100 transition">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <div className="font-semibold text-slate-800">
                        {r.machineId} · Ca {sh.shiftNumber} · {fmtDate(r.date)}
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium bg-blue-50 text-blue-700 border-blue-300">
                        {t.pending}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {sh.operatorName}
                    </div>
                  </button>
                );
              });
            })()}
            {pendingShiftsCount === 0 && <div className="text-center text-sm text-slate-400 py-6">{t.noPendingApproval}</div>}
          </div>
        </div>
      </div>

      {/* Machine grid - own dept */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-800 mb-3">{t.machinesOnline} ({user.dept})</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {myDeptMachines.map(m => {
            const r = todayReports.find(r => r.machineId === m.id);
            const s = r ? calcReportSummary(r) : null;
            return (
              <div key={m.id} className="p-3 rounded-xl border-2 border-slate-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-800">{m.name || m.id}</span>
                  {r ? <StatusBadge status={r.status} t={t} report={r} user={user} /> : <span className="text-xs text-slate-400">{t.noReportYet}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// DASHBOARD: CHIEF / AST CHIEF (all depts, final confirmation)
// ============================================================================
const ChiefDashboard = ({ user, reports, t, lang, onOpenReport, setCurrentPage }) => {
  const today = todayStr();
  const pending = reports.filter(r => r.status === 'leader_approved');
  const todayReports = reports.filter(r => r.date === today);

  const stats = useMemo(() => {
    let plan = 0, ok = 0, ng = 0, dt = 0;
    todayReports.forEach(r => {
      const s = calcReportSummary(r);
      plan += s.totalPlan; ok += s.totalOK; ng += s.totalNGAll; dt += s.totalDowntime;
    });
    return {
      plan, ok, ng, dt,
      ach: plan > 0 ? Math.round((ok / plan) * 100) : 0,
      defect: (ok + ng) > 0 ? ((ng / (ok + ng)) * 100).toFixed(2) : '0.00',
    };
  }, [todayReports]);

  // By dept
  const byDept = useMemo(() => {
    const depts = {};
    todayReports.forEach(r => {
      if (!depts[r.dept]) depts[r.dept] = { name: r.dept, plan: 0, actual: 0, ng: 0 };
      const s = calcReportSummary(r);
      depts[r.dept].plan += s.totalPlan;
      depts[r.dept].actual += s.totalOK;
      depts[r.dept].ng += s.totalNGAll;
    });
    return Object.values(depts);
  }, [todayReports]);

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-5 text-white flex items-center justify-between">
        <div>
          <div className="text-xs opacity-90 uppercase">{user.roleLabel} · Production</div>
          <div className="text-xl font-bold mt-1">{user.name}</div>
          <div className="text-sm opacity-90 mt-0.5">{t.allDepartments}</div>
        </div>
        {pending.length > 0 && (
          <button onClick={() => setCurrentPage?.('approvals')} className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white text-purple-700 hover:bg-purple-50 font-semibold text-sm shadow-lg">
            <ClipboardCheck className="w-5 h-5" /> {pending.length} {t.needsConfirmShort}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KpiCard label={t.todayReports} value={`${todayReports.length}/${machines.length}`} Icon={FileText} tone="blue" />
        <KpiCard label={t.needsConfirmShort} value={pending.length} Icon={ClipboardCheck} tone="purple" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-bold text-slate-800 bg-purple-50">{t.waitingChiefConfirm}</div>
        <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
          {pending.map(r => {
            return (
              <button key={r.id} onClick={() => onOpenReport(r)} className="w-full px-4 py-3 text-left hover:bg-purple-50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{r.machineId}</span>
                    <span className="text-xs text-slate-500">· {r.dept}</span>
                    <StatusBadge status={r.status} t={t} report={r} user={user} />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{fmtDate(r.date)}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            );
          })}
          {pending.length === 0 && <div className="p-8 text-center text-sm text-slate-400">{t.noPendingApproval}</div>}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// DASHBOARD: QA (quality-focused, NG analysis, no approvals)
// ============================================================================
const QADashboard = ({ user, reports, t, lang, onOpenReport }) => {
  const today = todayStr();
  const recent = reports.filter(r => r.status === 'chief_approved').slice(0, 30);

  // NG breakdown — aggregate from defectEntries (new model) with fallback to ngReasonId (legacy)
  const ngBreakdown = useMemo(() => {
    const map = {};
    recent.forEach(r => {
      r.shifts?.forEach(sh => sh.productEntries?.forEach(pe => {
        // New model: defectEntries array
        if (pe.defectEntries?.length > 0) {
          pe.defectEntries.forEach(de => {
            if (de.defectType) {
              map[de.defectType] = (map[de.defectType] || 0) + (de.quantity || 1);
            }
          });
        } else if (pe.ngReasonId) {
          // Legacy fallback
          const total = (pe.ng || 0) + (pe.ngTest || 0) + (pe.ngPending || 0);
          map[pe.ngReasonId] = (map[pe.ngReasonId] || 0) + total;
        }
      }));
    });
    return Object.entries(map).map(([id, value]) => ({ name: `${id}·${getNGReasonName(id, lang)}`, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [recent, lang]);

  // NG trend
  const ngTrend = useMemo(() => {
    const days = {};
    recent.forEach(r => {
      const s = calcReportSummary(r);
      if (!days[r.date]) days[r.date] = { date: r.date.substring(5), ok: 0, ng: 0 };
      days[r.date].ok += s.totalOK;
      days[r.date].ng += s.totalNGAll;
    });
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [recent]);

  const todayNG = reports.filter(r => r.date === today).reduce((sum, r) => {
    const s = calcReportSummary(r);
    return sum + s.totalNGAll;
  }, 0);

  const todayOK = reports.filter(r => r.date === today).reduce((sum, r) => {
    const s = calcReportSummary(r);
    return sum + s.totalOK;
  }, 0);

  const defectRate = (todayOK + todayNG) > 0 ? ((todayNG / (todayOK + todayNG)) * 100).toFixed(2) : '0.00';

  // Reports with high NG
  const highNG = recent.filter(r => {
    const s = calcReportSummary(r);
    return s.totalNGAll > 5;
  }).slice(0, 10);

  const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-5 text-white">
        <div className="text-xs opacity-90 uppercase">{t.qa} · Dashboard</div>
        <div className="text-xl font-bold mt-1">{user.name}</div>
        <div className="text-sm opacity-90 mt-0.5">{t.qualityDepartmentLong}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label={`${t.defectRate} (${t.todayReports})`} value={`${defectRate}%`} Icon={AlertTriangle} tone="rose" />
        <KpiCard label={`NG (${t.todayReports})`} value={todayNG} unit={t.unit} Icon={XCircle} tone="rose" />
        <KpiCard label={`OK (${t.todayReports})`} value={todayOK} unit={t.unit} Icon={CheckCircle} tone="emerald" />
        <KpiCard label={t.needsConfirmShort} value={highNG.length} Icon={FileWarning} tone="amber" sub="NG > 5" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.ngByType}</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={ngBreakdown} cx="50%" cy="50%" outerRadius={90} dataKey="value" labelLine={false} label={({ value }) => value}>
                {ngBreakdown.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.ngTrend14Days}</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={ngTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="ng" stroke="#ef4444" strokeWidth={2} name="NG" />
              <Line type="monotone" dataKey="ok" stroke="#10b981" strokeWidth={1} name="OK" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-bold text-slate-800 bg-rose-50">High NG Reports (NG &gt; 5)</div>
        <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
          {highNG.map(r => {
            const s = calcReportSummary(r);
            return (
              <button key={r.id} onClick={() => onOpenReport(r)} className="w-full px-4 py-3 text-left hover:bg-rose-50 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800">{r.machineId} · {fmtDate(r.date)}</div>
                  <div className="text-xs text-slate-500 mt-0.5">NG Total: {s.totalNGAll} · Defect Rate: {s.defectRate}%</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            );
          })}
          {highNG.length === 0 && <div className="p-8 text-center text-sm text-slate-400">{t.noHighNG}</div>}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// DASHBOARD: MAINTENANCE (downtime focus, no approvals)
// ============================================================================
const MaintenanceDashboard = ({ user, reports, t, lang, onOpenReport }) => {
  const today = todayStr();
  const completed = reports.filter(r => r.status === 'chief_approved').slice(0, 30);

  // Downtime by machine
  const dtByMachine = useMemo(() => machines.map(m => {
    const machineReports = completed.filter(r => r.machineId === m.id);
    let totalDt = 0;
    const byReason = {};
    machineReports.forEach(r => {
      r.shifts?.forEach(sh => sh.downtimeEntries?.forEach(dt => {
        totalDt += dt.minutes || 0;
        byReason[dt.reasonId] = (byReason[dt.reasonId] || 0) + (dt.minutes || 0);
      }));
    });
    return { name: m.id, downtime: totalDt, byReason };
  }), [completed]);

  // Downtime trend
  const dtTrend = useMemo(() => {
    const days = {};
    completed.forEach(r => {
      const s = calcReportSummary(r);
      if (!days[r.date]) days[r.date] = { date: r.date.substring(5), downtime: 0 };
      days[r.date].downtime += s.totalDowntime;
    });
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [completed]);

  const todayDt = reports.filter(r => r.date === today).reduce((sum, r) => {
    const s = calcReportSummary(r);
    return sum + s.totalDowntime;
  }, 0);

  // Critical downtimes (reason 7 = machine failure)
  const criticalDt = completed.filter(r => {
    return r.shifts?.some(sh => sh.downtimeEntries?.some(dt => dt.reasonId === 7));
  }).slice(0, 10);

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-r from-orange-600 to-red-600 rounded-2xl p-5 text-white">
        <div className="text-xs opacity-90 uppercase">{t.maintenance} · Dashboard</div>
        <div className="text-xl font-bold mt-1">{user.name}</div>
        <div className="text-sm opacity-90 mt-0.5">{t.maintenanceDepartmentLong}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label={`${t.downtimeTotal} (${t.todayReports})`} value={todayDt} unit={t.min} Icon={Clock} tone="amber" />
        <KpiCard label={t.breakdown} value={criticalDt.length} Icon={Wrench} tone="rose" sub="30 ngày" />
        <KpiCard label={t.totalMachinesShort} value={machines.length} Icon={Cog} tone="blue" />
        <KpiCard label={t.completedReports} value={completed.length} Icon={FileCheck} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.downtimeByMachine}</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dtByMachine}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} angle={-15} textAnchor="end" height={50} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip />
              <Bar dataKey="downtime" fill="#f59e0b" name={`${t.downtimeTotal} (${t.min})`} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.downtimeTrend14}</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={dtTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip />
              <Area type="monotone" dataKey="downtime" stroke="#f59e0b" fill="#fde68a" name={t.downtimeTotal} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-bold text-slate-800 bg-rose-50">{t.breakdownReports}</div>
        <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
          {criticalDt.map(r => (
            <button key={r.id} onClick={() => onOpenReport(r)} className="w-full px-4 py-3 text-left hover:bg-rose-50 flex items-center gap-3">
              <Wrench className="w-5 h-5 text-rose-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800">{r.machineId} · {fmtDate(r.date)}</div>
                <div className="text-xs text-slate-500">{r.line} · {r.dept}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          ))}
          {criticalDt.length === 0 && <div className="p-8 text-center text-sm text-slate-400">{t.noCriticalDowntime}</div>}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// DASHBOARD: DIRECTOR (high-level overview, all data)
// ============================================================================
const DirectorDashboard = ({ user, reports, t, lang, onOpenReport }) => {
  const today = todayStr();
  const completed = reports.filter(r => r.status === 'chief_approved');
  const todayReports = reports.filter(r => r.date === today);

  const stats = useMemo(() => {
    let plan = 0, ok = 0, ng = 0, dt = 0;
    todayReports.forEach(r => {
      const s = calcReportSummary(r);
      plan += s.totalPlan; ok += s.totalOK; ng += s.totalNGAll; dt += s.totalDowntime;
    });
    return {
      plan, ok, ng, dt,
      ach: plan > 0 ? Math.round((ok / plan) * 100) : 0,
      defect: (ok + ng) > 0 ? ((ng / (ok + ng)) * 100).toFixed(2) : '0.00',
    };
  }, [todayReports]);

  // 30-day trend
  const trend30 = useMemo(() => {
    const days = {};
    completed.forEach(r => {
      const s = calcReportSummary(r);
      if (!days[r.date]) days[r.date] = { date: r.date.substring(5), plan: 0, actual: 0, ng: 0 };
      days[r.date].plan += s.totalPlan;
      days[r.date].actual += s.totalOK;
      days[r.date].ng += s.totalNGAll;
    });
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  }, [completed]);

  // By line
  const byLine = useMemo(() => {
    const lines = {};
    todayReports.forEach(r => {
      if (!lines[r.line]) lines[r.line] = { name: r.line, value: 0 };
      const s = calcReportSummary(r);
      lines[r.line].value += s.totalOK;
    });
    return Object.values(lines);
  }, [todayReports]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="p-6 space-y-5 bg-slate-50 min-h-full">
      <div className="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl p-5 text-white">
        <div className="text-xs opacity-90 uppercase">{t.director} · Dashboard</div>
        <div className="text-xl font-bold mt-1">{user.name}</div>
        <div className="text-sm opacity-90 mt-0.5">FCC Vietnam - Factory Overview</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label={t.todayReports} value={`${todayReports.length}/${machines.length}`} Icon={FileText} tone="blue" />
        <KpiCard label={t.achievementRate} value={`${stats.ach}%`} Icon={TrendingUp} tone="emerald" />
        <KpiCard label={t.defectRate} value={`${stats.defect}%`} Icon={AlertTriangle} tone="rose" />
        <KpiCard label={t.downtimeTotal} value={stats.dt} unit={t.min} Icon={Clock} tone="amber" />
        <KpiCard label="Completed" value={completed.length} Icon={CheckCircle} tone="purple" />
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-800 mb-3">{t.trend30Days}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={trend30}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
            <YAxis stroke="#64748b" fontSize={11} />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="plan" stroke="#94a3b8" fill="#e2e8f0" name={t.planQty} />
            <Area type="monotone" dataKey="actual" stroke="#10b981" fill="#a7f3d0" name={t.actualQty} />
            <Area type="monotone" dataKey="ng" stroke="#ef4444" fill="#fecaca" name="NG" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.outputByLineToday}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byLine} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {byLine.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-3">{t.machineStatusToday}</h3>
          <div className="grid grid-cols-2 gap-2">
            {machines.map(m => {
              const r = todayReports.find(r => r.machineId === m.id);
              return (
                <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200">
                  <div className={`w-2 h-2 rounded-full ${r ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                  <span className="text-xs font-semibold">{m.id}</span>
                  {r && <StatusBadge status={r.status} t={t} report={r} user={user} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// OLD DASHBOARD (DISABLED)
// ============================================================================
const OldDashboard = ({ user, reports, t, lang, onOpenReport, onNewReport }) => {
  const today = todayStr();
  const todayReports = reports.filter(r => r.date === today);
  const pending = reports.filter(r => r.status === 'submitted' || r.status === 'leader_approved');
  const totalStats = useMemo(() => {
    let plan = 0, ok = 0, ng = 0, dt = 0;
    reports.filter(r => r.date === today).forEach(r => {
      const s = calcReportSummary(r);
      plan += s.totalPlan; ok += s.totalOK; ng += s.totalNGAll; dt += s.totalDowntime;
    });
    const achievement = plan > 0 ? Math.round((ok / plan) * 100) : 0;
    const defect = (ok + ng) > 0 ? ((ng / (ok + ng)) * 100).toFixed(2) : '0.00';
    return { plan, ok, ng, dt, achievement, defect };
  }, [reports]);

  // Trend data - last 7 days
  const trendData = useMemo(() => {
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const dayReports = reports.filter(r => r.date === ds);
      let plan = 0, ok = 0, ng = 0;
      dayReports.forEach(r => {
        const s = calcReportSummary(r);
        plan += s.totalPlan; ok += s.totalOK; ng += s.totalNGAll;
      });
      dates.push({ date: ds.substring(5), plan, actual: ok, ng });
    }
    return dates;
  }, [reports]);

  // Machine status - today
  const machineStatus = useMemo(() => machines.map(m => {
    const r = reports.find(r => r.date === today && r.machineId === m.id);
    if (!r) return { ...m, status: 'IDLE', achievement: 0 };
    const s = calcReportSummary(r);
    return { ...m, status: r.status, achievement: s.achievement, ok: s.totalOK, ng: s.totalNGAll };
  }), [reports]);

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-full">
      {/* Greeting */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-5 text-white flex items-center justify-between">
        <div>
          <div className="text-sm opacity-90">{t.dashboard}</div>
          <div className="text-xl font-bold mt-1">{user.name} · {user.roleLabel}</div>
          {user.machineId && <div className="text-sm opacity-90 mt-0.5">{t.machine}: {user.machineId} ({user.line})</div>}
        </div>
        {(user.role === 'operator' || user.role === 'team_leader') && (
          <button onClick={onNewReport} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-blue-700 hover:bg-blue-50 font-medium text-sm">
            <Plus className="w-4 h-4" /> {t.newReport}
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{t.todayReports}</span>
            <FileText className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-800">{todayReports.length}</div>
          <div className="text-xs text-slate-500 mt-1">/ {machines.length} {t.machine}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{t.achievementRate}</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600">{totalStats.achievement}%</div>
          <div className="text-xs text-slate-500 mt-1">{totalStats.ok} / {totalStats.plan} {t.unit}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{t.defectRate}</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600">{totalStats.defect}%</div>
          <div className="text-xs text-slate-500 mt-1">{totalStats.ng} NG</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{t.downtimeTotal}</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600">{totalStats.dt}</div>
          <div className="text-xs text-slate-500 mt-1">{t.min}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Production Trend */}
        <div className="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">{t.trend7Days}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="plan" stroke="#94a3b8" fill="#cbd5e1" name={t.planQty} />
              <Area type="monotone" dataKey="actual" stroke="#10b981" fill="#a7f3d0" name={t.actualQty} />
              <Area type="monotone" dataKey="ng" stroke="#ef4444" fill="#fecaca" name="NG" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pending Approvals */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center justify-between">
            {t.pendingApprovals}
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pending.length}</span>
          </h3>
          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {pending.slice(0, 6).map(r => (
              <button key={r.id} onClick={() => onOpenReport(r)} className="w-full text-left p-2 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-800">{r.machineId}</div>
                  <StatusBadge status={r.status} t={t} report={r} user={user} />
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{fmtDate(r.date)} · {r.line}</div>
              </button>
            ))}
            {pending.length === 0 && <div className="text-xs text-slate-400 text-center py-4">{t.noPendingApproval}</div>}
          </div>
        </div>
      </div>

      {/* Machine status grid */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-3">{t.machinesOnline}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {machineStatus.map(m => {
            const statusDot = {
              IDLE: 'bg-gray-400',
              draft: 'bg-gray-400',
              submitted: 'bg-blue-500',
              leader_approved: 'bg-amber-500',
              chief_approved: 'bg-emerald-500',
              rejected: 'bg-rose-500',
            }[m.status] || 'bg-gray-400';
            return (
              <div key={m.id} className="p-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:shadow-sm transition">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${statusDot} ${m.status === 'chief_approved' ? 'animate-pulse' : ''}`}></div>
                    <span className="text-sm font-semibold text-slate-800">{m.id}</span>
                  </div>
                  <Cog className="w-4 h-4 text-slate-400" />
                </div>
                <div className="text-xs text-slate-500">{m.line} · {m.dept}</div>
                {m.status !== 'IDLE' && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">{m.achievement}%</span>
                      <span className="text-emerald-600 font-medium">{m.ok || 0} OK</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, m.achievement)}%` }}></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: REPORTS LIST
// ============================================================================
const ReportsList = ({ reports, user, t, lang, onOpenReport, onNewReport }) => {
  const [filterStatus, setFilterStatus] = useState('all');
  // ★ Operator chỉ thấy reports của máy mình (default filter = user.machineId)
  // Sub Leader (team_leader) cần thấy tất cả reports vì họ duyệt cho cả team
  const isOpOnly = user.role === 'operator';
  const [filterMachine, setFilterMachine] = useState(isOpOnly ? (user.machineId || 'all') : 'all');
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    return reports.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterMachine !== 'all' && r.machineId !== filterMachine) return false;
      if (searchTerm && !r.id.toLowerCase().includes(searchTerm.toLowerCase()) && !r.machineId.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [reports, filterStatus, filterMachine, searchTerm]);

  // ★ Kiểm tra user đã report ca hôm nay chưa → disable nút "Tạo báo cáo mới"
  const canCreateReport = user.role === 'operator' || user.role === 'team_leader';
  const today = todayStr();
  const myTodayReport = canCreateReport && user.machineId
    ? reports.find(r => r.date === today && r.machineId === user.machineId)
    : null;
  const rlMyShiftIdx = (user.shiftNumber || 1) - 1;
  const rlMyShift = myTodayReport?.shifts?.[rlMyShiftIdx];
  const rlAlreadyReported = rlMyShift && rlMyShift.status && rlMyShift.status !== 'draft';

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">{t.reports}</h2>
          <p className="text-sm text-slate-500">{filtered.length} / {reports.length}</p>
        </div>
        {canCreateReport && (
          <button
            onClick={onNewReport}
            disabled={rlAlreadyReported}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${rlAlreadyReported ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            title={rlAlreadyReported ? (lang === 'vi' ? 'Bạn đã báo cáo ca này rồi' : 'このシフトは報告済みです') : ''}
          >
            <Plus className="w-4 h-4" /> {t.newReport}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={t.search}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
          <option value="all">{t.all}</option>
          <option value="draft">{t.draft}</option>
          <option value="submitted">{t.submitted}</option>
          <option value="leader_approved">{t.leaderApproved}</option>
          <option value="chief_approved">{t.chiefApproved}</option>
          <option value="rejected">{t.rejected}</option>
        </select>
        <select value={filterMachine} onChange={e => setFilterMachine(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
          <option value="all">{t.all} {t.machine}</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">{t.reportDate}</th>
                <th className="px-4 py-3 text-left">{t.machine}</th>
                <th className="px-4 py-3 text-left">{t.productionLine}</th>
                <th className="px-4 py-3 text-right">{t.planQty}</th>
                <th className="px-4 py-3 text-right">OK</th>
                <th className="px-4 py-3 text-right">NG</th>
                <th className="px-4 py-3 text-right">{t.achievementRate}</th>
                <th className="px-4 py-3 text-center">Ca 1</th>
                <th className="px-4 py-3 text-center">Ca 2</th>
                <th className="px-4 py-3 text-center">Ca 3</th>
                <th className="px-4 py-3 text-center">IFS</th>
                <th className="px-4 py-3 text-center">{t.view}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const s = calcReportSummary(r);
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-blue-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.id.substring(4)}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.machineId}</td>
                    <td className="px-4 py-3 text-slate-600">{r.line}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{s.totalPlan}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 font-medium">{s.totalOK}</td>
                    <td className="px-4 py-3 text-right text-rose-600">{s.totalNGAll}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${s.achievement >= 95 ? 'text-emerald-600' : s.achievement >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {s.achievement}%
                      </span>
                    </td>
                    {[1, 2, 3].map(sn => {
                      const sh = (r.shifts || []).find(s => s.shiftNumber === sn);
                      const st = sh?.status || 'draft';
                      return (
                        <td key={sn} className="px-2 py-3 text-center">
                          <ShiftStatusDot status={st} t={t} />
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      {r.ifsSynced ? <CheckCircle className="w-4 h-4 text-emerald-500 inline" /> : <XCircle className="w-4 h-4 text-slate-300 inline" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => onOpenReport(r)} className="p-1 hover:bg-blue-100 rounded text-blue-600">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-400">{t.noData}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: REPORT CREATION FORM (BM-02 - tablet-first, sticky header)
// ============================================================================
// Seed production data from monthly plan for a given machine+date.
// `globalOtEnabled` is the org-level OT toggle (from SettingsPage, owned by Ast/Chief).
// Plan-level OT override takes priority over this global setting.
const seedFromPlan = (machineId, dateStr, globalOtEnabled = true) => {
  const machine = getMachineById(machineId);
  // Nếu không tìm thấy máy → trả về 3 shift rỗng có cấu trúc đầy đủ (tránh crash forEach)
  if (!machine) {
    console.warn(`[seedFromPlan] Máy '${machineId}' không tìm thấy. Trả về shifts rỗng.`);
    return [1, 2, 3].map(shiftNum => ({
      shiftNumber: shiftNum,
      operatorId: '', operatorName: '',
      leaderId: '', leaderName: '', leaderFromPlan: false,
      startTime: shiftNum === 1 ? '06:00' : shiftNum === 2 ? '14:00' : '22:00',
      endTime:   shiftNum === 1 ? '14:00' : shiftNum === 2 ? '22:00' : '06:00',
      productEntries: [],
      downtimeEntries: [],
      overtimeEntries: [],
    }));
  }
  const [y, mo, d] = dateStr.split('-');
  const plans = generateMonthlyPlan(parseInt(y, 10), parseInt(mo, 10));
  const machinePlans = plans.filter(p => p.machineId === machineId);
  const dayKey = d;
  // Resolve OT visibility + planned minutes for this machine+day
  const otResolved = resolveOtForDay(plans, machineId, dateStr, globalOtEnabled);

  // Org-structure: each machine belongs to one department, and each shift in
  // that department has its own Sub Leader. A report's 3 shifts therefore route
  // to 3 different Sub Leaders for independent approval. Once all 3 shift
  // leaders approve, the report is promoted to the Ast Chief for final review.
  // (In real deployment this lookup is based on the dept+line+date plan roster.)
  // Pre-resolve operators for each shift of this machine (demo: assumes a stable
  // roster of 3 operators per machine, one per shift). So when shift 2's operator
  // opens the report, shift 1 already shows the expected shift-1 operator.
  const machineOperators = getOperatorsByMachine(machineId);
  const operatorForShift = (shiftNum) => {
    const match = machineOperators.find(o => o.shiftNumber === shiftNum);
    return match || machineOperators[(shiftNum - 1) % Math.max(1, machineOperators.length)] || null;
  };

  // Build 3 shifts with product entries from plan
  const shifts = [1, 2, 3].map(shiftNum => {
    const shiftOp = operatorForShift(shiftNum);
    const shiftLeader = getTeamLeaderByDeptAndShift(machine.dept, shiftNum);
    return {
      shiftNumber: shiftNum,
      operatorId: shiftOp?.id || '',
      operatorName: shiftOp?.name || '',
      // Pre-filled from org structure — each shift has its own Sub Leader.
      leaderId: shiftLeader?.id || '',
      leaderName: shiftLeader?.name || '',
      leaderFromPlan: !!shiftLeader,
      startTime: shiftNum === 1 ? '06:00' : shiftNum === 2 ? '14:00' : '22:00',
      endTime: shiftNum === 1 ? '14:00' : shiftNum === 2 ? '22:00' : '06:00',
      productEntries: [],
      downtimeEntries: [],
      // OT is an independent layer — never changes shift duration.
      // Each entry: { id, startTime, endTime, minutes, reasonId, okCount, ngCount, productCode, note }
      overtimeEntries: [],
    };
  });

  // ★ Nếu plan có ngày này → dùng plan. Nếu không (Chủ nhật/ngày lễ) → fallback ROUTING trực tiếp.
  //   Luôn tạo sẵn productEntries để user không phải bấm "Thêm sản phẩm".
  const hasPlanEntries = machinePlans.some(p => p.dailyPlans[dayKey]);

  if (hasPlanEntries) {
    machinePlans.forEach(plan => {
      const dp = plan.dailyPlans[dayKey];
      if (!dp) return;
      const _s1 = Math.ceil(dp.plan / 3);
      const _s2 = Math.ceil((dp.plan - _s1) / 2);
      const _s3 = dp.plan - _s1 - _s2;
      const _shiftPlans = [_s1, _s2, _s3];
      [0, 1, 2].forEach(si => {
        const shiftPlan = _shiftPlans[si];
        shifts[si].productEntries.push({
          id: `pe-seed-${plan.productCode}-${plan.operationName || ''}-s${si + 1}`,
          productCode: plan.productCode,
          productName_vi: plan.productName_vi,
          productName_ja: plan.productName_ja,
          operationName: plan.operationName || '',
          keyIFS: plan.keyIFS,
          docCode: plan.docCode,
          lotNumber: `L${dateStr.replace(/-/g, '')}-${machineId.substring(0, 6)}-S${si + 1}R${plan._step || ''}`,
          planQty: shiftPlan,
          okCount: shiftPlan,
          ngTest: 0,
          ngPending: 0,
          defectEntries: [],
          ifsSynced: false,
          fromPlan: true,
        });
      });
    });
  } else {
    // ★ Fallback: dùng ROUTING trực tiếp (Chủ nhật hoặc ngày chưa có plan)
    const machineRoutes = getRoutingForMachine(machineId);
    machineRoutes.forEach(route => {
      const product = findProductByCode(route.productCode);
      if (!product) return;
      const _s1 = Math.ceil(route.dailyQty / 3);
      const _s2 = Math.ceil((route.dailyQty - _s1) / 2);
      const _s3 = route.dailyQty - _s1 - _s2;
      const _shiftPlans = [_s1, _s2, _s3];
      [0, 1, 2].forEach(si => {
        const shiftPlan = _shiftPlans[si];
        shifts[si].productEntries.push({
          id: `pe-seed-${route.productCode}-${route.operation}-s${si + 1}`,
          productCode: route.productCode,
          productName_vi: `${product.name_vi} — ${route.operation}`,
          productName_ja: `${product.name_ja} — ${route.operationJa || route.operation}`,
          operationName: route.operation,
          keyIFS: product.keyIFS,
          docCode: product.docCode,
          lotNumber: `L${dateStr.replace(/-/g, '')}-${machineId.substring(0, 6)}-S${si + 1}R${route.step}`,
          planQty: shiftPlan,
          okCount: shiftPlan,
          ngTest: 0,
          ngPending: 0,
          defectEntries: [],
          ifsSynced: false,
          fromPlan: true,
        });
      });
    });
  }

  // Seed default downtime (computed from shift start/end times)
  // Rule:
  //   - Họp đầu ca (id=1):         startTime         → startTime + 5'
  //   - Kiểm tra máy (id=2):       startTime + 5'    → startTime + 10'
  //   - Viết báo cáo (id=12):      endTime   - 5'    → endTime
  shifts.forEach((sh, si) => {
    // 1. Họp đầu ca — first 5 minutes
    sh.downtimeEntries.push({
      id: `dt-seed-${si}-1`,
      reasonId: 1,
      startTime: sh.startTime,
      endTime: addMinutes(sh.startTime, 5),
      minutes: 5,
      note: '',
    });
    // 2. Kiểm tra máy đầu ca — next 5 minutes
    sh.downtimeEntries.push({
      id: `dt-seed-${si}-2`,
      reasonId: 2,
      startTime: addMinutes(sh.startTime, 5),
      endTime: addMinutes(sh.startTime, 10),
      minutes: 5,
      note: '',
    });
    // 12. Viết báo cáo cuối ca — last 5 minutes
    sh.downtimeEntries.push({
      id: `dt-seed-${si}-12`,
      reasonId: 12,
      startTime: addMinutes(sh.endTime, -5),
      endTime: sh.endTime,
      minutes: 5,
      note: '',
    });
    // Attach OT resolution metadata to every shift (so ReportForm knows visibility/source)
    sh.otVisible = otResolved.visible;
    sh.otSource = otResolved.source; // 'plan-on'|'plan-off'|'setting-on'|'setting-off'
    sh.otPlannedMinutes = otResolved.plannedMinutes;
    // If plan explicitly defines OT with planned minutes, auto-seed an OT entry
    // on shift 1 only (to avoid triple-counting the same planned block)
    if (otResolved.source === 'plan-on' && otResolved.plannedMinutes > 0 && si === 0) {
      sh.overtimeEntries.push({
        id: `ot-seed-${si}`,
        startTime: sh.endTime,
        endTime: addMinutes(sh.endTime, otResolved.plannedMinutes),
        minutes: otResolved.plannedMinutes,
        reasonId: 'OT01',
        productCode: '',
        okCount: 0,
        ngCount: 0,
        note: 'plan-ot',
        fromPlan: true,
      });
    }
  });

  return shifts;
};

// ============================================================================
// PER-SHIFT APPROVAL MODEL
// ============================================================================
// Each shift carries its own status:
//   'draft'            — operator still editing / not yet submitted
//   'submitted'        — submitted, awaiting sub-leader approval
//   'leader_approved'  — sub-leader approved this individual shift
//   'rejected'         — sub-leader rejected (operator must fix & resubmit)
//
// A report's top-level status is DERIVED from its 3 shifts + chief decision:
//   - approvedByChief set            → 'chief_approved'
//   - chief rejected                 → 'rejected' (report.rejectedBy === 'chief')
//   - all 3 shifts leader_approved   → 'leader_approved' (ready for Ast/Chief)
//   - any shift rejected             → 'rejected'
//   - any shift submitted            → 'submitted'
//   - otherwise                      → 'draft'
// The derived value is written back to report.status so all existing
// `r.status === 'X'` checks keep working unchanged.
// ============================================================================
const deriveReportStatus = (report) => {
  if (report.approvedByChief) return 'chief_approved';
  if (report.status === 'rejected' && report.rejectedBy === 'chief') return 'rejected';
  const shifts = report.shifts || [];
  if (shifts.length === 0) return 'draft';
  const statuses = shifts.map(s => s.status || 'draft');
  if (statuses.every(s => s === 'leader_approved')) return 'leader_approved';
  if (statuses.some(s => s === 'rejected')) return 'rejected';
  if (statuses.some(s => s === 'submitted' || s === 'leader_approved')) return 'submitted';
  return 'draft';
};

// ============================================================================
// VALIDATION: validate a full report (all 3 shifts) and return an array of
// errors. Each error has a stable `key` like `s1.operator` or
// `s2.product[0].ok` so the form can highlight the exact field in red.
// `allowedShiftIndices` (optional): if provided, only validate those shifts.
// Used when an operator is submitting only their own shift — empty data in
// other shifts must not block them.
// ============================================================================
const validateReport = (shifts, t, allowedShiftIndices = null) => {
  const errors = [];
  const add = (shiftIdx, key, msg) => errors.push({ shiftIdx, key, msg });

  shifts.forEach((sh, si) => {
    if (allowedShiftIndices && !allowedShiftIndices.includes(si)) return;
    if (sh.otVisible === false && sh.otSource === 'plan-off') {
      // shift-level field `otVisible` explicitly disabled: still validate shift basics
    }

    // Shift-level fields
    if (!sh.operatorId || !sh.operatorName) {
      add(si, 'operator', t.errOperatorMissing);
    }
    if (!sh.leaderId || !sh.leaderName) {
      add(si, 'leader', t.errLeaderMissing);
    }
    if (!sh.startTime || !sh.endTime) {
      add(si, 'shiftTime', t.errShiftTimeMissing);
    } else {
      const rangeCheck = validateShiftTimes(sh.shiftNumber, sh.startTime, sh.endTime);
      if (!rangeCheck.valid) {
        const msg =
          rangeCheck.reason === 'endBeforeStart' ? t.errShiftTimeEndBefore :
          rangeCheck.reason === 'tooShort' ? t.errShiftTimeTooShort :
          rangeCheck.reason === 'tooLong' ? t.errShiftTimeTooLong :
          t.errShiftTimeMissing;
        add(si, 'shiftTime', msg);
      }
    }

    // Product entries
    if (!sh.productEntries || sh.productEntries.length === 0) {
      add(si, 'products', t.errProductEmpty);
    } else {
      sh.productEntries.forEach((pe, pi) => {
        if (!pe.lotNumber || String(pe.lotNumber).trim() === '') {
          add(si, `product[${pi}].lot`, `${t.errLotMissing} (${pe.productCode || '?'})`);
        }
        if (pe.okCount == null || pe.okCount === '' || isNaN(pe.okCount)) {
          add(si, `product[${pi}].ok`, `${t.errOkMissing} (${pe.productCode || '?'})`);
        } else if ((pe.planQty || 0) > 0 && (pe.okCount || 0) > (pe.planQty || 0) * 1.5) {
          // Tolerate +50% (over-production), but flag > 150% as error
          // Skip check nếu planQty = 0 (WO chưa assign kế hoạch)
          add(si, `product[${pi}].ok`, `${t.errOkExceedsPlan} (${pe.productCode || '?'}: ${pe.okCount}/${pe.planQty})`);
        }
        // Validate NG Production: must have defect entries with all fields filled
        const ngProd = (pe.ng || 0);
        if (ngProd > 0) {
          const defects = pe.defectEntries || [];
          if (defects.length === 0) {
            // NG > 0 but no defect entries at all
            add(si, `product[${pi}].defectRequired`, `${t.errDefectEntryRequired} (${pe.productCode || '?'})`);
          } else {
            defects.forEach((defect, di) => {
              if (!defect.defectType) {
                add(si, `product[${pi}].defect[${di}].type`, `${t.errNgReasonMissing} (${pe.productCode || '?'})`);
              }
              if ((defect.quantity || 0) <= 0) {
                add(si, `product[${pi}].defect[${di}].qty`, `${t.errDefectQtyZero} (${pe.productCode || '?'})`);
              }
              if (!defect.rootCauseDetail) {
                add(si, `product[${pi}].defect[${di}].cause`, `${t.errDefectDetailMissing} (${pe.productCode || '?'})`);
              }
              if (!defect.countermeasure) {
                add(si, `product[${pi}].defect[${di}].counter`, `${t.errDefectCounterMissing} (${pe.productCode || '?'})`);
              }
            });
          }
        }
      });
    }

    // Downtime entries — must sit strictly INSIDE the shift window.
    // For shift 3 (22:00 → 06:00) the window wraps midnight; the helper
    // validateIntervalWithinShift handles that correctly.
    (sh.downtimeEntries || []).forEach((dt, di) => {
      if (!dt.startTime || !dt.endTime) {
        add(si, `downtime[${di}].time`, t.errDowntimeTimeMissing);
      } else if (sh.startTime && sh.endTime) {
        const chk = validateIntervalWithinShift(dt.startTime, dt.endTime, sh.startTime, sh.endTime);
        if (!chk.valid) {
          const msg =
            chk.reason === 'startOutside'   ? t.errDowntimeStartOutside :
            chk.reason === 'endOutside'     ? t.errDowntimeEndOutside :
            chk.reason === 'endBeforeStart' ? t.errDowntimeEndBeforeStart :
            chk.reason === 'tooLong'        ? t.errDowntimeTooLong :
                                              t.errDowntimeOutsideShift;
          add(si, `downtime[${di}].time`, msg);
        }
      }
      if (!dt.minutes || dt.minutes <= 0) {
        add(si, `downtime[${di}].minutes`, t.errDowntimeMinutesZero);
      }
    });

    // Overtime entries (only if OT layer visible for this shift)
    if (sh.otVisible) {
      (sh.overtimeEntries || []).forEach((ot, oi) => {
        if (!ot.startTime || !ot.endTime) {
          add(si, `overtime[${oi}].time`, t.errOtTimeMissing);
        }
        if (!ot.reasonId) {
          add(si, `overtime[${oi}].reason`, t.errOtReasonMissing);
        }
        if (!ot.productCode) {
          add(si, `overtime[${oi}].product`, t.errOtProductMissing);
        }
        if ((ot.minutes || 0) > 0 && (!ot.okCount || ot.okCount <= 0)) {
          add(si, `overtime[${oi}].output`, t.errOtOutputMissing);
        }
      });
    }
  });

  return errors;
};

const ReportForm = ({ user, reports, setReports, t, lang, onBack, existingReport, otEnabledGlobal = true }) => {
  const isEdit = !!existingReport;
  // ★ Demo mode: 1 người = 1 máy. Machine lấy từ user.machineId (WO assignment).
  // Không cho chọn máy khác — đơn giản, tránh nhầm lẫn.
  const [machineId, setMachineId] = useState(existingReport?.machineId || user.machineId || machines[0]?.id || '');
  const [reportDate, setReportDate] = useState(existingReport?.date || todayStr());
  const machine = getMachineById(machineId);

  // Operators default to their own shift tab; other roles start at shift 1.
  // Sub Leaders (team_leader) that have both machineId and shiftNumber act as
  // operators for their own machine/shift — they also auto-approve on submit.
  const isSubLeaderOperator = user.role === 'team_leader' && !!user.machineId && !!user.shiftNumber;
  const isOperator = user.role === 'operator' || isSubLeaderOperator;
  const ownShiftIdx = isOperator && user.shiftNumber ? user.shiftNumber - 1 : 0;

  // Inject the current user as operator of their own shift.
  // ★ ALWAYS override operator for own shift — seedFromPlan pre-fills with the
  //   regular operator (OP004 etc.) nhưng khi user đăng nhập tạo report thì
  //   chính họ mới là người vận hành ca đó (đặc biệt Sub Leader kiêm operator).
  // For sub leaders, also self-fill the leader fields (they are their own approver).
  const applyOperatorSelfFill = useCallback((shiftsArr) => {
    if (!isOperator || !user.shiftNumber) return shiftsArr;
    return shiftsArr.map((sh, i) => {
      if (i !== ownShiftIdx) return sh;
      const next = { ...sh };
      // ★ Always set current user as operator of their own shift
      next.operatorId = user.id;
      next.operatorName = user.name;
      if (isSubLeaderOperator) {
        // Sub Leader = cả operator lẫn leader → tự điền cả 2
        next.leaderId = user.id;
        next.leaderName = user.name;
      } else if (!next.leaderId) {
        // Regular operator → auto-fill leader từ danh sách users cùng dept + shift
        const leader = getTeamLeaderByDeptAndShift(user.dept, sh.shiftNumber);
        if (leader) { next.leaderId = leader.id; next.leaderName = leader.name; }
      }
      return next;
    });
  }, [isOperator, isSubLeaderOperator, user.id, user.name, user.dept, user.shiftNumber, ownShiftIdx]);

  // ★ Helper: tìm report đã load từ WO (middleware) cho máy+ngày hiện tại.
  // Ưu tiên: existingReport (edit mode) > WO report (từ middleware) > seedFromPlan (kế hoạch tĩnh)
  const findWoReport = useCallback((mid, date) => {
    return reports?.find(r => r.machineId === mid && r.date === date) || null;
  }, [reports]);

  // ★ Bổ sung downtime mặc định (Họp đầu ca, Kiểm tra máy, Viết báo cáo)
  //   cho WO report từ middleware — vì adapter không seed downtime.
  const enrichWoShiftsWithDefaults = (rawShifts) => rawShifts.map((sh, si) => {
    if (sh.downtimeEntries && sh.downtimeEntries.length > 0) return sh;
    const sTime = sh.startTime || (sh.shiftNumber === 1 ? '06:00' : sh.shiftNumber === 2 ? '14:00' : '22:00');
    const eTime = sh.endTime   || (sh.shiftNumber === 1 ? '14:00' : sh.shiftNumber === 2 ? '22:00' : '06:00');
    return {
      ...sh,
      downtimeEntries: [
        { id: `dt-wo-${si}-1`,  reasonId: 1,  startTime: sTime, endTime: addMinutes(sTime, 5),   minutes: 5, note: '' },
        { id: `dt-wo-${si}-2`,  reasonId: 2,  startTime: addMinutes(sTime, 5), endTime: addMinutes(sTime, 10), minutes: 5, note: '' },
        { id: `dt-wo-${si}-12`, reasonId: 12, startTime: addMinutes(eTime, -5), endTime: eTime,  minutes: 5, note: '' },
      ],
    };
  });

  const normalizeShifts = (rawShifts) => rawShifts.map(sh => ({
    shiftNumber: 1,
    operatorId: '', operatorName: '',
    leaderId: '', leaderName: '',
    startTime: '06:00', endTime: '14:00',
    ...sh,
    productEntries: sh.productEntries || [],
    downtimeEntries: sh.downtimeEntries || [],
    overtimeEntries: sh.overtimeEntries || [],
  }));

  // ★ Merge missing ROUTING products vào shifts — đảm bảo tất cả sản phẩm/công đoạn
  //   cho máy đều hiển thị, kể cả khi WO middleware chỉ trả về 1 sản phẩm.
  //   ⚠ Key = (productCode + operation) vì 1 sản phẩm có thể có nhiều công đoạn trên cùng 1 máy
  //     VD: TIEN01 có SP-A Tiện thô (step 1) VÀ SP-A Tiện tinh (step 3)
  const mergeRoutingProducts = useCallback((rawShifts, mid, dateStr) => {
    const machineRoutes = getRoutingForMachine(mid);
    if (machineRoutes.length === 0) return rawShifts;
    return rawShifts.map((sh, si) => {
      // Build composite key set: "SP-A::Tiện thô", "SP-A::Tiện tinh", ...
      // WO entries có operationName; seedFromPlan entries có operation trong productName_vi
      const existingKeys = new Set((sh.productEntries || []).map(pe => {
        const opName = pe.operationName
          || (pe.productName_vi || '').split(' — ')[1]
          || '';
        return `${pe.productCode}::${opName}`;
      }));
      const missing = machineRoutes.filter(r =>
        !existingKeys.has(`${r.productCode}::${r.operation}`)
      );
      if (missing.length === 0) return sh;
      // Also update existing entries that lack operation name in productName_vi
      const updatedEntries = (sh.productEntries || []).map(pe => {
        if (pe.productName_vi && pe.productName_vi.includes(' — ')) return pe; // already has operation
        const route = machineRoutes.find(r => r.productCode === pe.productCode
          && (!pe.operationName || pe.operationName === r.operation
              || pe.operationName.includes(r.operation.split(' ')[0])));
        if (!route) return pe;
        const product = findProductByCode(pe.productCode);
        return {
          ...pe,
          productName_vi: product ? `${product.name_vi} — ${route.operation}` : `${pe.productCode} — ${route.operation}`,
          productName_ja: product ? `${product.name_ja} — ${route.operationJa || route.operation}` : pe.productName_ja,
          operationName: route.operation,
        };
      });
      const extras = missing.map((route, mi) => {
        const product = findProductByCode(route.productCode);
        // Phân bổ khớp guideline: Ca1=ceil(N/3), Ca2=ceil(rem/2), Ca3=rest
        const _eq1 = Math.ceil(route.dailyQty / 3);
        const _eq2 = Math.ceil((route.dailyQty - _eq1) / 2);
        const _eq3 = route.dailyQty - _eq1 - _eq2;
        const shiftQty = [_eq1, _eq2, _eq3][si] || _eq1;
        return {
          id: `pe-merge-${route.productCode}-${route.step}-s${si + 1}`,
          productCode: route.productCode,
          productName_vi: product ? `${product.name_vi} — ${route.operation}` : `${route.productCode} — ${route.operation}`,
          productName_ja: product ? `${product.name_ja} — ${route.operationJa || route.operation}` : `${route.productCode} — ${route.operation}`,
          operationName: route.operation,
          keyIFS: product?.keyIFS || `IFS-${route.productCode}`,
          docCode: product?.docCode || `DC-${route.productCode}`,
          lotNumber: `L${dateStr.replace(/-/g, '')}-${mid.substring(0, 6)}-S${si + 1}R${route.step}`,
          planQty: shiftQty,
          okCount: shiftQty,
          ngTest: 0,
          ngPending: 0,
          defectEntries: [],
          ifsSynced: false,
          fromPlan: true,
        };
      });
      return { ...sh, productEntries: [...updatedEntries, ...extras] };
    });
  }, []);

  const [shifts, setShifts] = useState(() => {
    console.log('[ReportForm init]', { machineId, reportDate, userId: user.id, userMachineId: user.machineId, isEdit });
    if (existingReport?.shifts) {
      console.log('[ReportForm] Editing existing report', existingReport.machineId);
      // ★ Also apply self-fill when editing an existing report — ensures the
      //   current operator's shift has their name/leader even if the report was
      //   originally created by a different-shift operator.
      // ★ Merge missing routing products vào report đã tồn tại
      const merged = mergeRoutingProducts(normalizeShifts(existingReport.shifts), existingReport.machineId || machineId, existingReport.date || reportDate);
      return applyOperatorSelfFill(enrichWoShiftsWithDefaults(merged));
    }
    // ★ Check WO report từ middleware trước khi dùng seedFromPlan
    const woReport = findWoReport(machineId, reportDate);
    if (woReport?.shifts?.length) {
      console.log('[ReportForm] Dùng data từ WO middleware cho', machineId, reportDate, 'products:', woReport.shifts[0]?.productEntries?.map(p => p.operationName));
      const merged = mergeRoutingProducts(normalizeShifts(woReport.shifts), machineId, reportDate);
      return applyOperatorSelfFill(enrichWoShiftsWithDefaults(merged));
    }
    console.log('[ReportForm] seedFromPlan fallback cho', machineId, reportDate, 'routes:', getRoutingForMachine(machineId).map(r => `${r.productCode} ${r.operation}`));
    return applyOperatorSelfFill(seedFromPlan(machineId, reportDate, otEnabledGlobal));
  });
  const [activeShift, setActiveShift] = useState(ownShiftIdx);

  // For access control: operator can only edit own shift.
  // - Own shift: editable
  // - Past shift (submitted data exists): read-only, visible
  // - Future shift: hidden (data doesn't exist yet)
  const isShiftEditable = (shiftIdx) => {
    if (!isOperator) return true;
    return shiftIdx === ownShiftIdx;
  };
  const isShiftVisible = (shiftIdx) => {
    if (!isOperator) return true;
    // Own shift always visible
    if (shiftIdx === ownShiftIdx) return true;
    // Past shifts: visible (assume previously submitted)
    if (shiftIdx < ownShiftIdx) return true;
    // Future shifts: hidden
    return false;
  };
  const isCurrentShiftEditable = isShiftEditable(activeShift);

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [showDowntimePicker, setShowDowntimePicker] = useState(false);
  const [showNgPicker, setShowNgPicker] = useState(false);
  const [ngPickerCtx, setNgPickerCtx] = useState(null);
  const [defectQtyModalOpen, setDefectQtyModalOpen] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timePickerCtx, setTimePickerCtx] = useState(null);

  // Validation: empty list until user attempts to save/submit at least once.
  // After first attempt, re-validate live as the user fixes errors.
  // For operators: scope validation to own shift only (they can't edit other shifts).
  const [validationAttempted, setValidationAttempted] = useState(false);
  const allowedValidationShifts = useMemo(
    () => (isOperator ? [ownShiftIdx] : null),
    [isOperator, ownShiftIdx]
  );
  const validationErrors = useMemo(() => {
    if (!validationAttempted) return [];
    return validateReport(shifts, t, allowedValidationShifts);
  }, [shifts, validationAttempted, t, allowedValidationShifts]);

  // Build a lookup set so field components can self-check.
  // Key format: `${shiftIdx}|${fieldKey}` — matches the error's (shiftIdx, key).
  const errorKeys = useMemo(() => {
    const s = new Set();
    validationErrors.forEach(e => s.add(`${e.shiftIdx}|${e.key}`));
    return s;
  }, [validationErrors]);
  const hasError = (shiftIdx, key) => errorKeys.has(`${shiftIdx}|${key}`);
  // Errors scoped to the currently-active shift (shown in a banner)
  const currentShiftErrors = useMemo(
    () => validationErrors.filter(e => e.shiftIdx === activeShift),
    [validationErrors, activeShift]
  );

  // Re-seed when machine/date or global OT setting changes (only in create mode)
  useEffect(() => {
    if (!isEdit) {
      // ★ Ưu tiên WO report từ middleware, merge missing routing products
      const woReport = findWoReport(machineId, reportDate);
      if (woReport?.shifts?.length) {
        console.log('[ReportForm] Re-seed từ WO middleware cho', machineId, reportDate);
        const merged = mergeRoutingProducts(normalizeShifts(woReport.shifts), machineId, reportDate);
        setShifts(applyOperatorSelfFill(enrichWoShiftsWithDefaults(merged)));
      } else {
        setShifts(applyOperatorSelfFill(seedFromPlan(machineId, reportDate, otEnabledGlobal)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, reportDate, otEnabledGlobal]);

  // ★ Compatible products = routing entries cho máy hiện tại (mỗi entry = 1 product × 1 operation)
  const compatibleProducts = (() => {
    return getRoutingForMachine(machineId).map(r => {
      const product = findProductByCode(r.productCode);
      return product ? {
        ...product,
        name_vi: `${product.name_vi} — ${r.operation}`,
        name_ja: `${product.name_ja} — ${r.operationJa || r.operation}`,
        _operation: r.operation,
        _step: r.step,
        _dailyQty: r.dailyQty,
      } : null;
    }).filter(Boolean);
  })();

  const updateProductField = (shiftIdx, entryIdx, field, value) => {
    const newShifts = [...shifts];
    const pe = newShifts[shiftIdx].productEntries[entryIdx];
    pe[field] = value;
    // When NG value changes, reset all defect entry quantities to 1
    if (field === 'ng') {
      (pe.defectEntries || []).forEach(d => { d.quantity = 1; });
    }
    setShifts(newShifts);
  };

  const addProductEntry = () => {
    setShowProductModal(true);
  };

  const handleSelectProduct = (product) => {
    const newShifts = [...shifts];
    const shiftNum = activeShift + 1;
    // Phân bổ khớp guideline: Ca1=ceil(N/3), Ca2=ceil(rem/2), Ca3=rest
    const _dq = product._dailyQty || 0;
    const _pq1 = Math.ceil(_dq / 3);
    const _pq2 = Math.ceil((_dq - _pq1) / 2);
    const _pq3 = _dq - _pq1 - _pq2;
    const planQty = _dq ? [_pq1, _pq2, _pq3][activeShift] || _pq1 : Math.floor(machine[`shift${shiftNum}Cap`] * machine.rate / 4);
    newShifts[activeShift].productEntries.push({
      id: `pe-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      productCode: product.code,
      productName_vi: product.name_vi,  // already includes "— operation" from compatibleProducts
      productName_ja: product.name_ja,
      operationName: product._operation || '',
      keyIFS: product.keyIFS,
      docCode: product.docCode,
      lotNumber: `L${reportDate.replace(/-/g, '')}-${machineId.substring(0, 6)}-S${shiftNum}R${product._step || newShifts[activeShift].productEntries.length + 1}`,
      planQty,
      okCount: 0,
      ngTest: 0,
      ngPending: 0,
      defectEntries: [],
      ifsSynced: false,
      fromPlan: false,
    });
    setShifts(newShifts);
  };

  const removeProductEntry = (entryIdx) => {
    const newShifts = [...shifts];
    newShifts[activeShift].productEntries.splice(entryIdx, 1);
    setShifts(newShifts);
  };

  // Multi-defect management
  const handleAddDefect = (peIdx) => {
    const newShifts = [...shifts];
    const pe = newShifts[activeShift].productEntries[peIdx];
    if (!pe.defectEntries) pe.defectEntries = [];
    pe.defectEntries.push({
      defectType: '',
      quantity: 1,
      rootCause4M: '',
      rootCauseDetail: '',
      countermeasure: '',
    });
    setShifts(newShifts);
  };

  const handleRemoveDefect = (peIdx, defectIdx) => {
    const newShifts = [...shifts];
    newShifts[activeShift].productEntries[peIdx].defectEntries.splice(defectIdx, 1);
    setShifts(newShifts);
  };

  const handleDefectChange = (peIdx, defectIdx, field, value) => {
    const newShifts = [...shifts];
    newShifts[activeShift].productEntries[peIdx].defectEntries[defectIdx][field] = value;
    setShifts(newShifts);
  };

  // Downtime management
  const addDowntime = (reason) => {
    // Guard against duplicate singletons (1, 2, 12)
    if ([1, 2, 12].includes(reason.id) && shifts[activeShift].downtimeEntries.some(e => e.reasonId === reason.id)) {
      return;
    }
    const newShifts = [...shifts];
    const sh = newShifts[activeShift];
    // Compute default start/end based on shift times
    let startTime, endTime, minutes;
    if (reason.id === 1) {
      startTime = sh.startTime;
      endTime = addMinutes(sh.startTime, 5);
      minutes = 5;
    } else if (reason.id === 2) {
      startTime = addMinutes(sh.startTime, 5);
      endTime = addMinutes(sh.startTime, 10);
      minutes = 5;
    } else if (reason.id === 12) {
      startTime = addMinutes(sh.endTime, -5);
      endTime = sh.endTime;
      minutes = 5;
    } else {
      startTime = addMinutes(sh.startTime, 60);
      endTime = addMinutes(sh.startTime, 60 + (reason.defaultMin || 10));
      minutes = reason.defaultMin || 10;
    }
    sh.downtimeEntries.push({
      id: `dt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      reasonId: reason.id,
      startTime,
      endTime,
      minutes,
      note: '',
    });
    setShifts(newShifts);
  };

  const updateDowntime = (dtIdx, field, value) => {
    const newShifts = [...shifts];
    const entry = { ...newShifts[activeShift].downtimeEntries[dtIdx], [field]: value };
    // Recalc minutes from times
    if (field === 'startTime' || field === 'endTime') {
      entry.minutes = calcMinutes(entry.startTime, entry.endTime);
    }
    newShifts[activeShift].downtimeEntries[dtIdx] = entry;
    setShifts(newShifts);
  };

  const removeDowntime = (dtIdx) => {
    const newShifts = [...shifts];
    newShifts[activeShift].downtimeEntries.splice(dtIdx, 1);
    setShifts(newShifts);
  };

  // ================= OVERTIME (independent layer) =================
  const addOvertime = () => {
    const newShifts = [...shifts];
    const sh = newShifts[activeShift];
    if (!sh.overtimeEntries) sh.overtimeEntries = [];
    // Default: starts 0 min after shift end, lasts 60 minutes
    const startTime = sh.endTime;
    const endTime = addMinutes(sh.endTime, 60);
    sh.overtimeEntries.push({
      id: `ot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      startTime,
      endTime,
      minutes: 60,
      reasonId: 'OT01',
      productCode: '',
      okCount: 0,
      ngCount: 0,
      note: '',
    });
    setShifts(newShifts);
  };

  const updateOvertime = (otIdx, field, value) => {
    const newShifts = [...shifts];
    const sh = newShifts[activeShift];
    if (!sh.overtimeEntries) sh.overtimeEntries = [];
    const entry = { ...sh.overtimeEntries[otIdx], [field]: value };
    if (field === 'startTime' || field === 'endTime') {
      entry.minutes = calcMinutes(entry.startTime, entry.endTime);
    }
    sh.overtimeEntries[otIdx] = entry;
    setShifts(newShifts);
  };

  const removeOvertime = (otIdx) => {
    const newShifts = [...shifts];
    newShifts[activeShift].overtimeEntries.splice(otIdx, 1);
    setShifts(newShifts);
  };

  const updateShiftField = (shiftIdx, field, value) => {
    const newShifts = [...shifts];
    newShifts[shiftIdx][field] = value;
    setShifts(newShifts);
  };

  const openTimePicker = (ctx) => {
    setTimePickerCtx(ctx);
    setShowTimePicker(true);
  };

  const handleTimePicked = (time) => {
    if (!timePickerCtx) return;
    if (timePickerCtx.type === 'shift') {
      // Auto-adjust to keep (start < end) valid. For shift 3 a wrap-around is
      // expected (22:00 → 06:00 next day) so we don't flip it as an error.
      const shiftIdx = timePickerCtx.shiftIdx;
      const field = timePickerCtx.field;
      const newShifts = [...shifts];
      const sh = { ...newShifts[shiftIdx], [field]: time };
      const shiftNum = sh.shiftNumber;
      const check = validateShiftTimes(shiftNum, sh.startTime, sh.endTime);
      if (!check.valid && check.reason === 'endBeforeStart') {
        // Snap the non-edited field so the range is valid again.
        if (field === 'startTime') {
          // Keep the planned duration (8h) starting from the new start.
          sh.endTime = addMinutes(time, 8 * 60);
        } else {
          // field === 'endTime' — shrink start to be 8h before the new end.
          sh.startTime = addMinutes(time, -8 * 60);
        }
      }
      newShifts[shiftIdx] = sh;
      setShifts(newShifts);
    } else if (timePickerCtx.type === 'downtime') {
      updateDowntime(timePickerCtx.dtIdx, timePickerCtx.field, time);
    } else if (timePickerCtx.type === 'overtime') {
      updateOvertime(timePickerCtx.otIdx, timePickerCtx.field, time);
    }
    setTimePickerCtx(null);
  };

  // ★ Sync report data lên Odoo qua middleware API (fire-and-forget, không block UI)
  const syncToMiddleware = useCallback(async (appReport, targetShiftIndices, saveAsDraft) => {
    try {
      const payloads = [];
      for (const si of targetShiftIndices) {
        const shiftPayloads = adaptShiftForMiddleware(appReport, si, { saveAsDraft });
        payloads.push(...shiftPayloads);
      }
      if (payloads.length === 0) {
        console.warn('[syncToMiddleware] Không có productEntry nào để sync');
        return;
      }
      console.log(`[syncToMiddleware] Gửi ${payloads.length} WO(s) lên middleware...`);
      const results = [];
      for (const payload of payloads) {
        try {
          const result = await workOrderApi.submitReport(payload);
          results.push(result);
          console.log(`[syncToMiddleware] ✓ WO synced: ${payload.workcenter_code}/${payload.product_code}/${payload.shift}`);
        } catch (err) {
          console.error(`[syncToMiddleware] ✗ Lỗi sync WO ${payload.workcenter_code}/${payload.product_code}:`, err.message);
          // Không throw — tiếp tục sync các WO còn lại
        }
      }
      console.log(`[syncToMiddleware] Hoàn tất: ${results.length}/${payloads.length} thành công`);
    } catch (err) {
      console.error('[syncToMiddleware] Lỗi tổng:', err);
    }
  }, []);

  const handleSave = (asSubmit) => {
    // Determine which shift(s) this user is submitting:
    //   - operator   → only own shift
    //   - leader/chief editing a report → all shifts they edited are kept,
    //     but only the currently active one has its status flipped
    // Only validate shifts being submitted.
    const targetShiftIndices = isOperator ? [ownShiftIdx] : [activeShift];
    const errs = validateReport(shifts, t, targetShiftIndices);
    setValidationAttempted(true);
    if (errs.length > 0) {
      const firstShiftWithError = errs[0].shiftIdx;
      if (firstShiftWithError !== activeShift) {
        setActiveShift(firstShiftWithError);
      }
      setTimeout(() => {
        const scrollEl = document.querySelector('main');
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      }, 0);
      return;
    }

    const reportId = existingReport?.id || `RPT-${reportDate.replace(/-/g, '')}-${machineId}`;
    // Look up most-recent persisted version of the report (even if not in edit mode,
    // another operator may have already created it for the same day/machine).
    const persistedReport = reports.find(r => r.id === reportId);

    // Build a fresh shifts array: preserve all persisted shifts, overlay the
    // operator's target shift with the locally-edited version + new status.
    // Sub Leaders who are also the operator for their own shift auto-approve
    // (since they are both the worker AND the approver for that shift).
    const now = new Date().toISOString();
    const autoApproveOwnShift = asSubmit && isSubLeaderOperator;
    const newStatus = asSubmit
      ? (autoApproveOwnShift ? 'leader_approved' : 'submitted')
      : 'draft';
    const mergedShifts = (persistedReport?.shifts || shifts).map((persistedSh, i) => {
      if (!targetShiftIndices.includes(i)) return persistedSh;
      // Take the edited shift and stamp per-shift approval fields
      // Mark last rejection history entry as resubmitted (if any)
      const history = [...(persistedSh?.rejectionHistory || shifts[i]?.rejectionHistory || [])];
      if (asSubmit && history.length > 0 && !history[history.length - 1].resubmittedAt) {
        history[history.length - 1] = { ...history[history.length - 1], resubmittedAt: now };
      }
      return {
        ...shifts[i],
        status: newStatus,
        submittedAt: asSubmit ? now : (persistedSh?.submittedAt || null),
        // Auto-approval: sub leader simultaneously approves their own shift
        approvedByLeader: autoApproveOwnShift ? user.id : null,
        approvedByLeaderAt: autoApproveOwnShift ? now : null,
        rejectReason: null,
        rejectionHistory: history,
      };
    });

    const baseReport = persistedReport || {
      id: reportId,
      date: reportDate,
      machineId,
      machineName: machine.name,
      line: machine.line,
      dept: machine.dept,
      createdBy: user.id,
      createdAt: now,
      approvedByChief: null,
      approvedByChiefAt: null,
      ifsSynced: false,
      ifsSyncedAt: null,
    };

    const updatedReport = {
      ...baseReport,
      shifts: mergedShifts,
      // Recompute top-level status from per-shift statuses
      status: 'draft', // placeholder, will be overwritten below
    };
    updatedReport.status = deriveReportStatus(updatedReport);

    // ★ Lưu local state trước (UI responsive ngay)
    // Dùng functional updater để tránh stale closure — đảm bảo dùng data mới nhất
    setReports(prev => {
      const exists = prev.some(r => r.id === reportId);
      if (exists) {
        return prev.map(r => r.id === reportId ? updatedReport : r);
      } else {
        return [updatedReport, ...prev];
      }
    });

    // ★ Sync lên Odoo qua middleware (async, không block UI)
    const saveAsDraft = !asSubmit;
    syncToMiddleware(updatedReport, targetShiftIndices, saveAsDraft);

    onBack();
  };

  // Summary — tracks in-shift vs OT separately
  const summary = useMemo(() => {
    let plan = 0, ok = 0, ngTotal = 0, dt = 0;
    let otMin = 0, otOk = 0, otNg = 0;
    shifts.forEach(sh => {
      (sh.productEntries || []).forEach(pe => {
        plan += pe.planQty || 0;
        ok += pe.okCount || 0;
        const defectNG = (pe.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
        ngTotal += (pe.ngTest || 0) + (defectNG || pe.ng || 0) + (pe.ngPending || 0);
      });
      (sh.downtimeEntries || []).forEach(de => { dt += de.minutes || 0; });
      (sh.overtimeEntries || []).forEach(ot => {
        otMin += ot.minutes || 0;
        otOk += ot.okCount || 0;
        otNg += ot.ngCount || 0;
      });
    });
    return { plan, ok, ngTotal, dt, otMin, otOk, otNg, ach: plan > 0 ? Math.round((ok / plan) * 100) : 0 };
  }, [shifts]);

  const shiftSummary = useMemo(() => {
    const sh = shifts[activeShift] || {};
    let plan = 0, ok = 0, ngT = 0, dt = 0;
    let otMin = 0, otOk = 0, otNg = 0;
    (sh.productEntries || []).forEach(pe => {
      plan += pe.planQty || 0;
      ok += pe.okCount || 0;
      const defectNG = (pe.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
      ngT += (pe.ngTest || 0) + (defectNG || pe.ng || 0) + (pe.ngPending || 0);
    });
    (sh.downtimeEntries || []).forEach(de => { dt += de.minutes || 0; });
    (sh.overtimeEntries || []).forEach(ot => {
      otMin += ot.minutes || 0;
      otOk += ot.okCount || 0;
      otNg += ot.ngCount || 0;
    });
    return { plan, ok, ngT, dt, otMin, otOk, otNg, ach: plan > 0 ? Math.round((ok / plan) * 100) : 0 };
  }, [shifts, activeShift]);

  const currentShift = shifts[activeShift];
  const shiftLabels = [t.shift1, t.shift2, t.shift3];
  // True if any shift in the current report allows OT (used by 3-shift totals)
  const anyOtVisible = useMemo(() => shifts.some(s => s.otVisible), [shifts]);

  return (
    <div className="bg-slate-50 min-h-full relative">
      {/* ============ STICKY HEADER ============ */}
      <div className="sticky top-0 z-30 bg-slate-900 text-white shadow-lg">
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="p-2 rounded-xl hover:bg-slate-700 active:bg-slate-600">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-400 uppercase tracking-wide">{t.bm02Code}</div>
              <h2 className="text-lg font-bold truncate">{isEdit ? `${t.edit} · ${t.bm02Title}` : t.newReport}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => isCurrentShiftEditable && handleSave(false)}
              disabled={!isCurrentShiftEditable}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition ${
                isCurrentShiftEditable
                  ? 'border-slate-600 hover:bg-slate-800 active:bg-slate-700'
                  : 'border-slate-700 text-slate-500 cursor-not-allowed opacity-50'
              }`}
            >
              <Save className="w-4 h-4" /> <span className="hidden sm:inline">{t.save}</span>
            </button>
            <button
              onClick={() => isCurrentShiftEditable && handleSave(true)}
              disabled={!isCurrentShiftEditable}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-md transition ${
                isCurrentShiftEditable
                  ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-50'
              }`}
            >
              <Send className="w-4 h-4" /> <span className="hidden sm:inline">{t.submit}</span>
            </button>
          </div>
        </div>

        {/* Shift tabs */}
        {<div className="flex border-t border-slate-800 bg-slate-800">
          {[0, 1, 2].map(i => {
            const active = activeShift === i;
            const editable = isShiftEditable(i);
            const visible = isShiftVisible(i);
            const isOwn = i === ownShiftIdx;
            return (
              <button key={i} onClick={() => setActiveShift(i)}
                className={`flex-1 px-4 py-3 text-sm font-semibold transition relative ${
                  active
                    ? (editable ? 'bg-blue-600 text-white border-b-2 border-blue-300' : 'bg-slate-600 text-slate-200 border-b-2 border-slate-400')
                    : 'text-slate-300 hover:bg-slate-700'
                }`}>
                <div className="flex items-center justify-center gap-1.5">
                  <span>{shiftLabels[i]}</span>
                  {isOperator && isOwn && <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">{t.myShiftTag}</span>}
                  {isOperator && !editable && !visible && <span className="text-[10px]">🚫</span>}
                  {isOperator && !editable && visible && <span className="text-[10px]">👁</span>}
                </div>
                <div className="text-xs opacity-80 mt-0.5">{visible ? `${shifts[i].productEntries.length} SP` : '—'}</div>
              </button>
            );
          })}
        </div>}
      </div>

      {/* ============ CONTENT ============ */}
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        {/* Header meta card */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium">{t.reportDate}</label>
              <input
                type="date"
                value={reportDate}
                min={daysAgoStr(MIN_REPORT_DATE_OFFSET)}
                max={todayStr()}
                onChange={e => {
                  const v = e.target.value;
                  const minStr = daysAgoStr(MIN_REPORT_DATE_OFFSET);
                  const maxStr = todayStr();
                  // Clamp defensively in case an on-screen keyboard bypasses min/max
                  if (v < minStr) { setReportDate(minStr); return; }
                  if (v > maxStr) { setReportDate(maxStr); return; }
                  setReportDate(v);
                }}
                className="mt-1 w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-base font-semibold focus:outline-none focus:border-blue-500" />
              <div className="mt-1 text-[11px] text-slate-400">{t.dateRestrictHint}</div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">{t.machine}</label>
              <div className="mt-1 px-3 py-3 rounded-xl bg-slate-100 border-2 border-slate-200 text-base font-semibold text-slate-700 flex items-center gap-2">
                <Cog className="w-4 h-4 text-slate-400" />
                {machine?.name || machineId || '—'}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">{t.productionLine}</label>
              <div className="mt-1 px-3 py-3 rounded-xl bg-slate-100 border-2 border-slate-200 text-base font-semibold text-slate-700">{user.line || machine?.line || '—'}</div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">{t.department}</label>
              <div className="mt-1 px-3 py-3 rounded-xl bg-slate-100 border-2 border-slate-200 text-base font-semibold text-slate-700">{user.dept || machine?.dept || '—'}</div>
            </div>
          </div>

          {/* Auto-seeded banner */}
          {!isEdit && currentShift.productEntries.some(pe => pe.fromPlan) && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800">
                <div className="font-semibold">{t.autoFilledFromPlan}</div>
                <div className="text-xs text-emerald-700 mt-0.5">{t.noteCurrentPlanSameEdit}</div>
              </div>
            </div>
          )}
        </div>

        {/* Machine prompt removed — demo: 1 person = 1 machine, auto-assigned */}

        {/* Future-shift placeholder (operator viewing a shift that hasn't happened yet) */}
        {isOperator && !isShiftVisible(activeShift) && (
          <div className="bg-white rounded-2xl p-10 shadow-sm border-2 border-dashed border-slate-300 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Clock className="w-8 h-8 text-slate-400" />
            </div>
            <div className="text-lg font-bold text-slate-700">{shiftLabels[activeShift]} · {t.shiftNotStartedTitle}</div>
            <div className="text-sm text-slate-500 mt-1">{t.shiftNotStarted}</div>
            <div className="text-xs text-slate-400 mt-3">{t.dataWillAppear}</div>
            <button
              onClick={() => setActiveShift(ownShiftIdx)}
              className="mt-4 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              ← {t.backToMyShift} ({shiftLabels[ownShiftIdx]})
            </button>
          </div>
        )}

        {/* Read-only banner (operator viewing a past shift) */}
        {isOperator && isShiftVisible(activeShift) && !isCurrentShiftEditable && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 flex items-start gap-2">
            <Eye className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 flex-1">
              <div className="font-semibold">{t.viewOnlyMode}</div>
              <div className="text-xs text-amber-700 mt-0.5">{lang === 'vi' ? `Đây là báo cáo của ${shiftLabels[activeShift]} (do operator ca khác nhập). Bạn có thể xem nhưng không chỉnh sửa được.` : `これは${shiftLabels[activeShift]}の報告です (他のオペレータが入力)。閲覧はできますが編集はできません。`}</div>
            </div>
            <button onClick={() => setActiveShift(ownShiftIdx)} className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline flex-shrink-0">
              ← {t.backToMyShift}
            </button>
          </div>
        )}

        {/* ============ VALIDATION ERROR BANNER ============ */}
        {validationAttempted && validationErrors.length > 0 && (
          <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-rose-600 text-white px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{t.validationTitle}</div>
                <div className="text-xs opacity-90">{t.validationHint}</div>
              </div>
              <div className="bg-white text-rose-700 px-3 py-1 rounded-full text-xs font-black flex-shrink-0">
                {validationErrors.length} {t.errorsCount}
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto divide-y divide-rose-100">
              {[0, 1, 2].map(si => {
                const shiftErrs = validationErrors.filter(e => e.shiftIdx === si);
                if (shiftErrs.length === 0) return null;
                return (
                  <div key={si} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setActiveShift(si)}
                      className="text-xs font-bold text-rose-800 hover:text-rose-900 underline"
                    >
                      {shiftLabels[si]} · {shiftErrs.length} {t.errorsCount}
                    </button>
                    <ul className="mt-1 space-y-0.5">
                      {shiftErrs.slice(0, 6).map((e, i) => (
                        <li key={i} className="text-[11px] text-rose-700 flex items-start gap-1.5">
                          <span className="text-rose-400">•</span>
                          <span>{e.msg}</span>
                        </li>
                      ))}
                      {shiftErrs.length > 6 && (
                        <li className="text-[11px] text-rose-500 italic">...и ещё {shiftErrs.length - 6}</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Shift content wrapper - greyed out when not editable */}
        {isShiftVisible(activeShift) && (
        <div className={`space-y-4 ${!isCurrentShiftEditable ? 'opacity-60 pointer-events-none select-none' : ''}`}>

        {/* Shift operator & leader */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-blue-500 rounded"></div>
            <h3 className="font-bold text-slate-800">{shiftLabels[activeShift]} · {t.shiftOperator} / {t.shiftLeader}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-xs text-slate-500 font-medium flex items-center gap-1 h-5">
                {t.shiftOperator}
                {hasError(activeShift, 'operator') && (
                  <span className="text-rose-600 font-bold">*</span>
                )}
              </label>
              <select
                value={currentShift.operatorId}
                onChange={e => {
                  const u = getUserById(e.target.value);
                  updateShiftField(activeShift, 'operatorId', e.target.value);
                  updateShiftField(activeShift, 'operatorName', u?.name || '');
                }}
                className={`mt-1 w-full h-[52px] px-3 rounded-xl border-2 text-base focus:outline-none focus:border-blue-500 ${
                  hasError(activeShift, 'operator') ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                }`}
              >
                <option value="">-- {t.selectUser} --</option>
                {getTeamOperators(machine?.dept, currentShift.shiftNumber).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium flex items-center gap-1 h-5">
                {t.shiftLeader}
                {hasError(activeShift, 'leader') && (
                  <span className="text-rose-600 font-bold">*</span>
                )}
                {currentShift.leaderFromPlan && currentShift.leaderId && !hasError(activeShift, 'leader') && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[9px] font-bold border border-indigo-200">
                    {t.byPlan}
                  </span>
                )}
              </label>
              <select
                value={currentShift.leaderId}
                onChange={e => {
                  const u = getUserById(e.target.value);
                  updateShiftField(activeShift, 'leaderId', e.target.value);
                  updateShiftField(activeShift, 'leaderName', u?.name || '');
                  updateShiftField(activeShift, 'leaderFromPlan', false);
                }}
                className={`mt-1 w-full h-[52px] px-3 rounded-xl border-2 text-base focus:outline-none focus:border-blue-500 ${
                  hasError(activeShift, 'leader')
                    ? 'border-rose-400 bg-rose-50'
                    : currentShift.leaderFromPlan && currentShift.leaderId
                      ? 'border-indigo-300 bg-indigo-50/30'
                      : 'border-slate-200'
                }`}
              >
                <option value="">-- {t.selectUser} --</option>
                {mockUsers.filter(u => u.role === 'team_leader').map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.dept})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium flex items-center gap-1">
                {t.startTime}
                {hasError(activeShift, 'shiftTime') && <span className="text-rose-600 font-bold">*</span>}
              </label>
              <button onClick={() => openTimePicker({ type: 'shift', shiftIdx: activeShift, field: 'startTime' })}
                className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-base font-mono font-bold text-left hover:border-blue-400 active:bg-blue-50 flex items-center justify-between ${
                  hasError(activeShift, 'shiftTime') && !currentShift.startTime ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                }`}>
                <span>{currentShift.startTime || '--:--'}</span>
                <Clock className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium flex items-center gap-1">
                {t.endTime}
                {hasError(activeShift, 'shiftTime') && <span className="text-rose-600 font-bold">*</span>}
              </label>
              <button onClick={() => openTimePicker({ type: 'shift', shiftIdx: activeShift, field: 'endTime' })}
                className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-base font-mono font-bold text-left hover:border-blue-400 active:bg-blue-50 flex items-center justify-between ${
                  hasError(activeShift, 'shiftTime') && !currentShift.endTime ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                }`}>
                <span>{currentShift.endTime || '--:--'}</span>
                <Clock className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>
          {/* Inline error messages for this shift's top-level fields */}
          {validationAttempted && currentShiftErrors.filter(e => ['operator', 'leader', 'shiftTime', 'products'].includes(e.key)).length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200">
              <ul className="space-y-1">
                {currentShiftErrors
                  .filter(e => ['operator', 'leader', 'shiftTime', 'products'].includes(e.key))
                  .map((e, i) => (
                    <li key={i} className="text-[11px] text-rose-700 flex items-start gap-1.5">
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{e.msg}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        {/* ============ PRODUCT ENTRIES ============ */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-emerald-500 rounded"></div>
              <h3 className="font-bold text-slate-800">{t.products}</h3>
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold">
                {currentShift.productEntries.length}
              </span>
            </div>
            <button onClick={addProductEntry}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 shadow-sm">
              <Plus className="w-4 h-4" /> {t.addProduct}
            </button>
          </div>

          <div className="space-y-3">
            {currentShift.productEntries.map((entry, ei) => {
              const defectNG = (entry.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
              const hasNGProduction = (defectNG || entry.ng || 0) > 0;
              return (
                <div key={entry.id} className="border-2 border-slate-200 rounded-2xl overflow-hidden">
                  {/* Product header */}
                  <div className="bg-slate-800 text-white p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-sm font-bold flex-shrink-0">{ei + 1}</div>
                      <div className="min-w-0">
                        <div className="font-bold truncate">{entry[`productName_${lang}`]}</div>
                        <div className="text-xs text-slate-300 truncate">{entry.productCode} · {entry.keyIFS}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-2xl font-bold tabular-nums">
                        {entry.okCount}<span className="text-sm text-slate-400">/{entry.planQty}</span>
                      </div>
                      {entry.fromPlan && (
                        <div className="text-xs text-emerald-300 flex items-center justify-end gap-1">
                          <Check className="w-3 h-3" /> {t.asPlanned}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Product body */}
                  <div className="p-3 bg-slate-50 space-y-3">
                    {/* Lot + actions row */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className={`text-xs font-medium ${hasError(activeShift, `product[${ei}].lot`) ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                          {t.lotNumber}{hasError(activeShift, `product[${ei}].lot`) && ' *'}
                        </label>
                        <input value={entry.lotNumber}
                          onChange={e => updateProductField(activeShift, ei, 'lotNumber', e.target.value)}
                          className={`mt-0.5 w-full px-3 py-2.5 rounded-xl border-2 text-sm font-mono focus:outline-none focus:border-blue-500 ${
                            hasError(activeShift, `product[${ei}].lot`) ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-300' : 'border-slate-200'
                          }`} />
                      </div>
                      <button onClick={() => removeProductEntry(ei)}
                        className="mt-5 p-3 rounded-xl text-rose-500 bg-white border-2 border-rose-200 hover:bg-rose-50 active:bg-rose-100 flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Production numbers: Plan + OK */}
                    <div className="grid grid-cols-2 gap-2">
                      <NumberInputTablet
                        label={t.planQty}
                        value={entry.planQty}
                        onChange={() => {}}
                        tone="plan"
                        readOnly={true}
                        lang={lang}
                      />
                      <NumberInputTablet
                        label="OK"
                        value={entry.okCount}
                        onChange={v => updateProductField(activeShift, ei, 'okCount', v)}
                        tone="ok"
                        step={5}
                        error={hasError(activeShift, `product[${ei}].ok`)}
                        lang={lang}
                      />
                    </div>

                    {/* NG section - 3 types in a row */}
                    <div className="grid grid-cols-3 gap-2">
                      <NumberInputTablet
                        label="NG TEST"
                        value={entry.ngTest}
                        onChange={v => updateProductField(activeShift, ei, 'ngTest', v)}
                        tone="warn"
                        step={1}
                        lang={lang}
                      />
                      <NumberInputTablet
                        label="NG"
                        value={entry.ng}
                        onChange={v => updateProductField(activeShift, ei, 'ng', v)}
                        tone="ng"
                        step={1}
                        lang={lang}
                      />
                      <NumberInputTablet
                        label={t.ngPendingCount}
                        value={entry.ngPending}
                        onChange={v => updateProductField(activeShift, ei, 'ngPending', v)}
                        tone="default"
                        step={1}
                        lang={lang}
                      />
                    </div>

                    {/* NG Production defect details — ONLY for NG Production (not NG Test / NG Pending) */}
                    {hasNGProduction && (
                      <div className="mt-1 p-3 bg-rose-50 rounded-xl border-2 border-rose-200">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-rose-500 rounded"></div>
                            <span className="text-sm font-bold text-rose-700">{t.defectEntries}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 font-medium">{lang === 'ja' ? 'NG生産のみ' : 'Chỉ NG sản xuất'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {(entry.defectEntries || []).length > 0 && (
                              <span className="text-xs text-slate-500">
                                {t.totalNGAuto}: {(entry.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0)}
                              </span>
                            )}
                            <button
                              onClick={() => handleAddDefect(ei)}
                              className="px-2 py-1 text-xs rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> {t.addDefect}
                            </button>
                          </div>
                        </div>

                        {(entry.defectEntries || []).length === 0 && (
                          <div className="text-xs text-slate-400 py-2">{t.noDefects}</div>
                        )}

                        {(entry.defectEntries || []).map((defect, di) => {
                          // Max qty for each defect = NG value (1 product can have multiple defect types simultaneously)
                          const maxDefectQty = Math.max(1, entry.ng || 0);
                          return (
                          <div key={di} className="mb-3 p-3 bg-white rounded-lg border border-rose-200 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-rose-800">#{di + 1}</span>
                              <button
                                onClick={() => handleRemoveDefect(ei, di)}
                                className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-100 rounded"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Row 1: Defect Type (modal picker) + Quantity (NumberInputTablet) */}
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div>
                                <label className="text-xs text-slate-500 block mb-1">{t.defectType}</label>
                                <button
                                  type="button"
                                  onClick={() => { setNgPickerCtx({ type: 'defectType', entryIdx: ei, defectIdx: di }); setShowNgPicker(true); }}
                                  className={`w-full h-[52px] px-3 rounded-xl border-2 text-left text-sm font-bold transition active:scale-95 flex items-center ${
                                    defect.defectType
                                      ? 'border-rose-300 bg-rose-50 text-rose-800'
                                      : 'border-slate-200 bg-white text-slate-400 hover:border-blue-400'
                                  }`}
                                >
                                  {defect.defectType
                                    ? `${defect.defectType} · ${getNGReasonName(defect.defectType, lang)}`
                                    : `-- ${t.defectType} --`}
                                </button>
                              </div>
                              <div>
                                <label className="text-xs text-slate-500 block mb-1">{t.defectQty} <span className="text-rose-400 font-medium">({lang === 'ja' ? `最大${entry.ng || 0}` : `tối đa ${entry.ng || 0}`})</span></label>
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Open number wheel for this defect quantity
                                    setNgPickerCtx({ type: '_defectQty', entryIdx: ei, defectIdx: di, maxQty: maxDefectQty });
                                    setDefectQtyModalOpen(true);
                                  }}
                                  className="w-full h-[52px] px-3 rounded-xl border-2 text-center text-xl font-black tabular-nums bg-rose-50 border-rose-300 text-rose-900 hover:border-rose-500 transition active:scale-95 cursor-pointer flex items-center justify-center"
                                >
                                  {defect.quantity || 0}
                                </button>
                              </div>
                            </div>

                            {/* Row 2: Root Cause 4M (modal picker) */}
                            <div className="mb-2">
                              <label className="text-xs text-slate-500 block mb-1">{t.defectDetail}</label>
                              <button
                                type="button"
                                onClick={() => { setNgPickerCtx({ type: 'defectRootCause', entryIdx: ei, defectIdx: di }); setShowNgPicker(true); }}
                                className={`w-full px-3 py-2.5 rounded-xl border-2 text-left text-sm transition active:scale-95 ${
                                  defect.rootCauseDetail
                                    ? 'border-amber-300 bg-amber-50 text-amber-800 font-semibold'
                                    : 'border-slate-200 bg-white text-slate-400 hover:border-blue-400'
                                }`}
                              >
                                {defect.rootCauseDetail
                                  ? (() => { const rc = rootCauses.find(x => x.id === defect.rootCauseDetail); return rc ? `[${t[rc.category === 'machine' ? 'machineCat' : rc.category] || rc.category}] ${rc.id} · ${rc[`name_${lang}`]}` : defect.rootCauseDetail; })()
                                  : `-- ${t.rootCause} (4M) --`}
                              </button>
                            </div>

                            {/* Row 3: Countermeasure (modal picker) */}
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">{t.defectCountermeasure}</label>
                              <button
                                type="button"
                                onClick={() => { setNgPickerCtx({ type: 'defectCountermeasure', entryIdx: ei, defectIdx: di }); setShowNgPicker(true); }}
                                className={`w-full px-3 py-2.5 rounded-xl border-2 text-left text-sm transition active:scale-95 ${
                                  defect.countermeasure
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold'
                                    : 'border-slate-200 bg-white text-slate-400 hover:border-blue-400'
                                }`}
                              >
                                {defect.countermeasure
                                  ? `${defect.countermeasure} · ${getCounterName(defect.countermeasure, lang)}`
                                  : `-- ${t.countermeasure} --`}
                              </button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Inline error list for this product entry */}
                    {validationAttempted && (() => {
                      const entryErrs = currentShiftErrors.filter(e => e.key.startsWith(`product[${ei}]`));
                      if (entryErrs.length === 0) return null;
                      return (
                        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-700 mb-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            {t.fixBeforeSave}
                          </div>
                          <ul className="space-y-0.5">
                            {entryErrs.map((e, i) => (
                              <li key={i} className="text-[11px] text-rose-700 ml-5 list-disc">{e.msg}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
            {currentShift.productEntries.length === 0 && (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-2xl">
                <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <div className="text-sm text-slate-400">{t.noData}</div>
              </div>
            )}
          </div>
        </div>

        {/* ============ DOWNTIME SECTION ============ */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-rose-500 rounded"></div>
              <h3 className="font-bold text-slate-800">停止時間 / {t.downtimeTitle}</h3>
              {currentShift.downtimeEntries.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-rose-500 text-white text-xs font-bold">
                  {currentShift.downtimeEntries.length}
                </span>
              )}
            </div>
            <button onClick={() => setShowDowntimePicker(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200">
              <Plus className="w-4 h-4" /> {t.addDowntime}
            </button>
          </div>

          <div className="space-y-2">
            {currentShift.downtimeEntries
              .map((dt, originalIdx) => ({ dt, originalIdx }))
              .sort((a, b) => {
                const ta = (a.dt.startTime || '99:99');
                const tb = (b.dt.startTime || '99:99');
                // Wrap-around aware: entries that look like "late night" from a next-day
                // shift 3 (e.g. 22:00) should come BEFORE 05:55. We use shift start time
                // to determine ordering: anything earlier than shift startTime wraps.
                const shiftStart = currentShift.startTime || '00:00';
                const normalize = (t) => (t >= shiftStart ? t : `z${t}`); // 'z' > any digit
                return normalize(ta).localeCompare(normalize(tb));
              })
              .map(({ dt, originalIdx }, sortedIdx) => {
                const reason = downtimeReasons.find(r => r.id === dt.reasonId);
                const errTime = hasError(activeShift, `downtime[${originalIdx}].time`);
                const errMin = hasError(activeShift, `downtime[${originalIdx}].minutes`);
                const hasAnyErr = errTime || errMin;
                return (
                <div key={dt.id || originalIdx} className={`border-2 rounded-2xl overflow-hidden ${hasAnyErr ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'}`}>
                  <div className="bg-blue-500 text-white p-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white text-blue-600 text-sm font-black flex-shrink-0">{sortedIdx + 1}</span>
                      <Clock className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{reason?.[`name_${lang}`]}</span>
                    </div>
                    <button onClick={() => removeDowntime(originalIdx)} className="p-1.5 rounded-lg hover:bg-blue-600 active:bg-blue-700 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={`text-xs font-medium ${errTime ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.startShort}{errTime && ' *'}</label>
                        <button onClick={() => openTimePicker({ type: 'downtime', dtIdx: originalIdx, field: 'startTime' })}
                          className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-base font-mono font-bold text-center hover:border-blue-400 active:bg-blue-50 ${
                            errTime ? 'border-rose-500 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white'
                          }`}>
                          {dt.startTime || '--:--'}
                        </button>
                      </div>
                      <div>
                        <label className={`text-xs font-medium ${errTime ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.endShort}{errTime && ' *'}</label>
                        <button onClick={() => openTimePicker({ type: 'downtime', dtIdx: originalIdx, field: 'endTime' })}
                          className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-base font-mono font-bold text-center hover:border-blue-400 active:bg-blue-50 ${
                            errTime ? 'border-rose-500 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white'
                          }`}>
                          {dt.endTime || '--:--'}
                        </button>
                      </div>
                      <div>
                        <label className={`text-xs font-medium ${errMin ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.downtimeMinutes}{errMin && ' *'}</label>
                        <div className={`mt-1 px-3 py-3 rounded-xl border-2 text-base font-bold text-center ${
                          errMin ? 'border-rose-500 bg-rose-100 ring-2 ring-rose-300 text-rose-900' : 'bg-rose-50 border-rose-200 text-rose-700'
                        }`}>
                          {dt.minutes} {t.min}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <input
                        value={dt.note || ''}
                        onChange={e => updateDowntime(originalIdx, 'note', e.target.value)}
                        placeholder={t.notePlaceholder}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    {/* Inline error list for this downtime entry */}
                    {hasAnyErr && (
                      <div className="mt-2 p-2 rounded-lg bg-rose-50 border border-rose-300">
                        <ul className="space-y-0.5">
                          {validationErrors
                            .filter(e => e.shiftIdx === activeShift && (e.key === `downtime[${originalIdx}].time` || e.key === `downtime[${originalIdx}].minutes`))
                            .map((e, i) => (
                              <li key={i} className="text-[11px] text-rose-700 flex items-start gap-1.5">
                                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <span>{e.msg}</span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {currentShift.downtimeEntries.length === 0 && (
              <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-2xl">
                <PauseCircle className="w-8 h-8 text-slate-300 mx-auto mb-1" />
                <div className="text-xs text-slate-400">{t.noDowntime}</div>
              </div>
            )}
          </div>
        </div>

        {/* ============ OVERTIME SECTION (independent layer, outside shift hours) ============ */}
        {/* Hidden entirely when OT is off in both plan and global setting */}
        {currentShift.otVisible && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 bg-purple-500 rounded"></div>
              <h3 className="font-bold text-slate-800">{t.overtimeTitle}</h3>
              {(currentShift.overtimeEntries || []).length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-purple-500 text-white text-xs font-bold">
                  {currentShift.overtimeEntries.length}
                </span>
              )}
            </div>
            <button onClick={addOvertime}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-purple-300 text-sm font-semibold text-purple-700 hover:bg-purple-50 active:bg-purple-100">
              <Plus className="w-4 h-4" /> {t.addOvertime}
            </button>
          </div>
          {/* Source badge: shows whether OT visibility comes from plan or from org-level setting */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {currentShift.otSource === 'plan-on' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 text-[11px] font-bold border border-purple-300">
                {t.otSourcePlanOn}
                {currentShift.otPlannedMinutes > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-purple-600 text-white rounded text-[10px]">
                    {t.otPlannedMin}: {currentShift.otPlannedMinutes} {t.min}
                  </span>
                )}
              </span>
            )}
            {currentShift.otSource === 'setting-on' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold border border-slate-300">
                {t.otSourceSettingOn}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mb-3 italic">💡 {t.overtimeHint}</div>

          <div className="space-y-2">
            {(currentShift.overtimeEntries || []).map((ot, oi) => {
              const errOtTime = hasError(activeShift, `overtime[${oi}].time`);
              const errOtReason = hasError(activeShift, `overtime[${oi}].reason`);
              const errOtProduct = hasError(activeShift, `overtime[${oi}].product`);
              const errOtOutput = hasError(activeShift, `overtime[${oi}].output`);
              const hasAnyOtErr = errOtTime || errOtReason || errOtProduct || errOtOutput;
              return (
                <div key={ot.id || oi} className={`border-2 rounded-2xl overflow-hidden ${hasAnyOtErr ? 'border-rose-400 ring-2 ring-rose-200' : 'border-purple-200'}`}>
                  <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white text-purple-600 text-sm font-black flex-shrink-0">{oi + 1}</span>
                      <span className="px-2 py-0.5 bg-white/20 rounded-md text-[10px] uppercase tracking-wide flex-shrink-0">OT</span>
                      <span className="truncate">{getOvertimeReasonName(ot.reasonId, lang)}</span>
                    </div>
                    <button onClick={() => removeOvertime(oi)} className="p-1.5 rounded-lg hover:bg-white/20 active:bg-white/30 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-3 bg-purple-50/40 space-y-2">
                    {/* Time row */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={`text-xs font-medium ${errOtTime ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.startShort}{errOtTime && ' *'}</label>
                        <button onClick={() => openTimePicker({ type: 'overtime', otIdx: oi, field: 'startTime' })}
                          className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-base font-mono font-bold text-center hover:border-purple-400 active:bg-purple-50 ${
                            errOtTime ? 'border-rose-500 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white'
                          }`}>
                          {ot.startTime || '--:--'}
                        </button>
                      </div>
                      <div>
                        <label className={`text-xs font-medium ${errOtTime ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.endShort}{errOtTime && ' *'}</label>
                        <button onClick={() => openTimePicker({ type: 'overtime', otIdx: oi, field: 'endTime' })}
                          className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-base font-mono font-bold text-center hover:border-purple-400 active:bg-purple-50 ${
                            errOtTime ? 'border-rose-500 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white'
                          }`}>
                          {ot.endTime || '--:--'}
                        </button>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 font-medium">{t.overtimeMinutes}</label>
                        <div className="mt-1 px-3 py-3 rounded-xl bg-purple-100 border-2 border-purple-200 text-base font-bold text-center text-purple-700">
                          {ot.minutes} {t.min}
                        </div>
                      </div>
                    </div>
                    {/* Reason row */}
                    <div>
                      <label className={`text-xs font-medium ${errOtReason ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.overtimeReason}{errOtReason && ' *'}</label>
                      <select value={ot.reasonId} onChange={e => updateOvertime(oi, 'reasonId', e.target.value)}
                        className={`mt-1 w-full px-3 py-3 rounded-xl border-2 text-sm focus:outline-none focus:border-purple-500 ${
                          errOtReason ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-300' : 'border-slate-200 bg-white'
                        }`}>
                        <option value="">--</option>
                        {overtimeReasons.map(r => (
                          <option key={r.id} value={r.id}>{r.id} · {r[`name_${lang}`]}</option>
                        ))}
                      </select>
                    </div>
                    {/* Output row */}
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <label className={`text-xs font-medium block mb-1 ${errOtProduct ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{t.productLabel}{errOtProduct && ' *'}</label>
                        <select value={ot.productCode || ''} onChange={e => updateOvertime(oi, 'productCode', e.target.value)}
                          className={`w-full h-[52px] px-3 rounded-xl border-2 text-sm focus:outline-none focus:border-purple-500 ${
                            errOtProduct ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-300' : 'border-slate-200 bg-white'
                          }`}>
                          <option value="">--</option>
                          {compatibleProducts.map(p => <option key={p.code} value={p.code}>{p.code}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={`text-xs font-medium ${errOtOutput ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>OK{errOtOutput && ' *'}</label>
                        <NumberInputTablet
                          value={ot.okCount}
                          onChange={v => updateOvertime(oi, 'okCount', v)}
                          tone="emerald"
                          error={errOtOutput}
                          lang={lang}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 font-medium">NG</label>
                        <NumberInputTablet
                          value={ot.ngCount}
                          onChange={v => updateOvertime(oi, 'ngCount', v)}
                          tone="rose"
                          lang={lang}
                        />
                      </div>
                    </div>
                    <div>
                      <input
                        value={ot.note || ''}
                        onChange={e => updateOvertime(oi, 'note', e.target.value)}
                        placeholder={t.notePlaceholder}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:border-purple-500" />
                    </div>
                    {/* Inline error list for this overtime entry */}
                    {hasAnyOtErr && (
                      <div className="p-2 rounded-lg bg-rose-50 border border-rose-300">
                        <ul className="space-y-0.5">
                          {validationErrors
                            .filter(e => e.shiftIdx === activeShift && e.key.startsWith(`overtime[${oi}]`))
                            .map((e, i) => (
                              <li key={i} className="text-[11px] text-rose-700 flex items-start gap-1.5">
                                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <span>{e.msg}</span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {(currentShift.overtimeEntries || []).length === 0 && (
              <div className="text-center py-6 border-2 border-dashed border-purple-200 rounded-2xl bg-purple-50/30">
                <Clock className="w-8 h-8 text-purple-300 mx-auto mb-1" />
                <div className="text-xs text-slate-500">{t.overtimeNone}</div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* ============ SUMMARY CARD (In-shift vs OT) ============ */}
        <div className="bg-slate-800 text-white rounded-2xl p-4 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-blue-400 rounded"></div>
            <h3 className="font-bold">集計 / {t.total} ({shiftLabels[activeShift]})</h3>
          </div>

          {/* In-shift section */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300">定時内 / {t.inShift}</div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-700 rounded-xl p-3">
                <div className="text-xs text-slate-400 uppercase">{t.planQty}</div>
                <div className="text-2xl font-bold mt-1">{shiftSummary.plan}</div>
              </div>
              <div className="bg-slate-700 rounded-xl p-3">
                <div className="text-xs text-slate-400 uppercase">{t.actualQty}</div>
                <div className="text-2xl font-bold mt-1">{shiftSummary.ok}</div>
              </div>
              <div className="bg-slate-700 rounded-xl p-3">
                <div className="text-xs text-slate-400 uppercase">成績率 / {t.achievementRate}</div>
                <div className={`text-2xl font-bold mt-1 ${shiftSummary.ach >= 100 ? 'text-emerald-400' : shiftSummary.ach >= 80 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {shiftSummary.ach}%
                </div>
              </div>
              <div className="bg-slate-700 rounded-xl p-3">
                <div className="text-xs text-slate-400 uppercase">{t.defectLabel}</div>
                <div className={`text-2xl font-bold mt-1 ${shiftSummary.ngT > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {shiftSummary.ngT}
                </div>
              </div>
              <div className="bg-slate-700 rounded-xl p-3 col-span-2">
                <div className="text-xs text-slate-400 uppercase">停止 / {t.downtimeTotal}</div>
                <div className={`text-2xl font-bold mt-1 ${shiftSummary.dt > 30 ? 'text-rose-400' : 'text-slate-200'}`}>
                  {shiftSummary.dt} <span className="text-sm">{t.min}</span>
                </div>
              </div>
            </div>
          </div>

          {/* OT section — only when OT is allowed (plan-on or setting-on) */}
          {currentShift.otVisible && (
          <div className="pt-3 border-t border-slate-700">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-purple-300">時間外 · {t.overtime}</div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-purple-900/40 border border-purple-700/50 rounded-xl p-3">
                <div className="text-xs text-purple-300 uppercase">{t.overtimeTotal}</div>
                <div className="text-2xl font-bold mt-1 text-purple-200">
                  {shiftSummary.otMin} <span className="text-sm">{t.min}</span>
                </div>
              </div>
              <div className="bg-purple-900/40 border border-purple-700/50 rounded-xl p-3">
                <div className="text-xs text-purple-300 uppercase">{t.overtimeOutput} OK</div>
                <div className="text-2xl font-bold mt-1 text-emerald-300">{shiftSummary.otOk}</div>
              </div>
              <div className="bg-purple-900/40 border border-purple-700/50 rounded-xl p-3">
                <div className="text-xs text-purple-300 uppercase">OT NG</div>
                <div className={`text-2xl font-bold mt-1 ${shiftSummary.otNg > 0 ? 'text-rose-300' : 'text-slate-400'}`}>{shiftSummary.otNg}</div>
              </div>
            </div>
          </div>
          )}

        </div>

        {/* ============ 3-SHIFT TOTALS (separate card) ============ */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-4 shadow-lg border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-6 bg-amber-400 rounded"></div>
            <h3 className="text-base font-bold tracking-wide">{t.total3Shifts} {anyOtVisible ? '(In-shift + OT)' : '(In-shift)'}</h3>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-slate-700/60 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 uppercase">{t.planQty}</div>
              <div className="text-xl font-bold mt-1">{summary.plan}</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 uppercase">OK</div>
              <div className="text-xl font-bold mt-1 text-emerald-400">{summary.ok + (anyOtVisible ? summary.otOk : 0)}</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 uppercase">NG</div>
              <div className="text-xl font-bold mt-1 text-rose-400">{summary.ngTotal + (anyOtVisible ? summary.otNg : 0)}</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 uppercase">停止</div>
              <div className="text-xl font-bold mt-1 text-amber-400">{summary.dt}{t.min}</div>
            </div>
          </div>
          {anyOtVisible && (
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-700/50">
            <div className="bg-purple-900/40 border border-purple-700/50 rounded-xl p-3">
              <div className="text-[11px] text-purple-300 uppercase">OT合計</div>
              <div className="text-xl font-bold mt-1 text-purple-300">{summary.otMin}{t.min}</div>
            </div>
            <div className="bg-purple-900/40 border border-purple-700/50 rounded-xl p-3">
              <div className="text-[11px] text-purple-300 uppercase">OT OK</div>
              <div className="text-xl font-bold mt-1 text-purple-300">{summary.otOk}</div>
            </div>
          </div>
          )}
        </div>

        </div>
        )}
        {/* /shift content wrapper */}

        <div className="h-4"></div>
      </div>

      {/* ============ MODALS ============ */}
      <ReasonPickerModal
        open={showProductModal}
        title={t.selectProduct}
        options={compatibleProducts}
        onSelect={handleSelectProduct}
        onClose={() => setShowProductModal(false)}
        lang={lang}
      />

      <ReasonPickerModal
        open={showDowntimePicker}
        title={`${t.addDowntime} · ${t.downtimeReason}`}
        options={downtimeReasons}
        onSelect={addDowntime}
        onClose={() => setShowDowntimePicker(false)}
        lang={lang}
        disabledIds={
          // Singletons: Họp đầu ca (1), Kiểm tra máy (2), Viết báo cáo cuối ca (12)
          // can only be added once per shift.
          [1, 2, 12].filter(id => currentShift.downtimeEntries.some(e => e.reasonId === id))
        }
        disabledLabel={t.alreadyInShift}
      />

      <ReasonPickerModal
        open={showNgPicker}
        title={
          ngPickerCtx?.type === 'defectType' ? t.defectType :
          ngPickerCtx?.type === 'defectRootCause' ? `${t.rootCause} (4M)` :
          ngPickerCtx?.type === 'defectCountermeasure' ? t.defectCountermeasure :
          ngPickerCtx?.type === 'ngReason' ? t.ngReason :
          ngPickerCtx?.type === 'rootCause' ? `${t.rootCause} (4M)` :
          t.countermeasure
        }
        options={
          ngPickerCtx?.type === 'defectType' ? ngReasons :
          ngPickerCtx?.type === 'defectRootCause' ? rootCauses :
          ngPickerCtx?.type === 'defectCountermeasure' ? countermeasures :
          ngPickerCtx?.type === 'ngReason' ? ngReasons :
          ngPickerCtx?.type === 'rootCause' ? rootCauses :
          ngPickerCtx?.type === 'countermeasure' ? countermeasures : []
        }
        onSelect={(opt) => {
          if (!ngPickerCtx) return;
          // Defect entry fields (new multi-defect model)
          if (ngPickerCtx.defectIdx !== undefined) {
            const { entryIdx, defectIdx, type } = ngPickerCtx;
            if (type === 'defectType') {
              handleDefectChange(entryIdx, defectIdx, 'defectType', opt.id);
            } else if (type === 'defectRootCause') {
              handleDefectChange(entryIdx, defectIdx, 'rootCause4M', opt.category || '');
              handleDefectChange(entryIdx, defectIdx, 'rootCauseDetail', opt.id);
            } else if (type === 'defectCountermeasure') {
              handleDefectChange(entryIdx, defectIdx, 'countermeasure', opt.id);
            }
          } else {
            // Legacy single-defect fields
            const fieldMap = { ngReason: 'ngReasonId', rootCause: 'rootCauseId', countermeasure: 'countermeasureId' };
            updateProductField(ngPickerCtx.shiftIdx, ngPickerCtx.entryIdx, fieldMap[ngPickerCtx.type], opt.id);
          }
          setNgPickerCtx(null);
        }}
        onClose={() => { setShowNgPicker(false); setNgPickerCtx(null); }}
        lang={lang}
      />

      <NumberWheelModal
        open={defectQtyModalOpen}
        value={ngPickerCtx?.type === '_defectQty'
          ? ((shifts[activeShift]?.productEntries[ngPickerCtx.entryIdx]?.defectEntries || [])[ngPickerCtx.defectIdx]?.quantity || 0)
          : 0}
        onSelect={(v) => {
          if (ngPickerCtx?.type === '_defectQty') {
            const clamped = Math.min(Math.max(1, v), ngPickerCtx.maxQty || 1);
            handleDefectChange(ngPickerCtx.entryIdx, ngPickerCtx.defectIdx, 'quantity', clamped);
          }
          setNgPickerCtx(null);
        }}
        onClose={() => { setDefectQtyModalOpen(false); setNgPickerCtx(null); }}
        title={`${t.defectQty} (${lang === 'ja' ? '最大' : 'tối đa'} ${ngPickerCtx?.maxQty || 0})`}
        tone="ng"
        lang={lang}
      />

      <TimePickerModal
        open={showTimePicker}
        title={timePickerCtx?.field === 'startTime' ? t.startTime : t.endTime}
        initial={
          timePickerCtx?.type === 'shift' ? currentShift[timePickerCtx.field] :
          timePickerCtx?.type === 'downtime' ? currentShift.downtimeEntries[timePickerCtx.dtIdx]?.[timePickerCtx.field] :
          timePickerCtx?.type === 'overtime' ? (currentShift.overtimeEntries || [])[timePickerCtx.otIdx]?.[timePickerCtx.field] : ''
        }
        onSelect={handleTimePicked}
        onClose={() => { setShowTimePicker(false); setTimePickerCtx(null); }}
        lang={lang}
        t={t}
      />
    </div>
  );
};

// ============================================================================
// UI: REPORT CREATION FORM (OLD - DISABLED)
// ============================================================================
const ReportForm_OLD_DISABLED = ({ user, reports, setReports, t, lang, onBack, existingReport }) => {
  const isEdit = !!existingReport;
  const defaultMachine = user.machineId || machines[0].id;
  const [machineId, setMachineId] = useState(existingReport?.machineId || defaultMachine);
  const [reportDate, setReportDate] = useState(existingReport?.date || todayStr());
  const machine = getMachineById(machineId);

  const emptyShift = (shiftNum) => ({
    shiftNumber: shiftNum,
    operatorId: user.role === 'operator' ? user.id : '',
    operatorName: user.role === 'operator' ? user.name : '',
    leaderId: '',
    leaderName: '',
    productEntries: [],
    downtimeEntries: downtimeReasons.filter(r => r.defaultMin > 0).map(r => ({ reasonId: r.id, minutes: r.defaultMin })),
  });

  const [shifts, setShifts] = useState(existingReport?.shifts || [emptyShift(1), emptyShift(2), emptyShift(3)]);
  const [activeShift, setActiveShift] = useState(0);
  const [showProductModal, setShowProductModal] = useState(false);
  const [productModalCtx, setProductModalCtx] = useState(null);
  const [showDowntimeModal, setShowDowntimeModal] = useState(false);

  // ★ Compatible products = routing entries cho máy hiện tại (mỗi entry = 1 product × 1 operation)
  const compatibleProducts = (() => {
    return getRoutingForMachine(machineId).map(r => {
      const product = findProductByCode(r.productCode);
      return product ? {
        ...product,
        name_vi: `${product.name_vi} — ${r.operation}`,
        name_ja: `${product.name_ja} — ${r.operationJa || r.operation}`,
        _operation: r.operation,
        _step: r.step,
        _dailyQty: r.dailyQty,
      } : null;
    }).filter(Boolean);
  })();

  const addProductEntry = (shiftIdx) => {
    setProductModalCtx({ shiftIdx });
    setShowProductModal(true);
  };

  const handleSelectProduct = (product) => {
    const { shiftIdx } = productModalCtx;
    const newEntries = [...shifts];
    const planQty = product._dailyQty ? Math.ceil(product._dailyQty / 3) : Math.floor(machine[`shift${shiftIdx + 1}Cap`] * machine.rate);
    const newEntry = {
      id: `pe-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      productCode: product.code,
      productName_vi: product.name_vi,  // already includes "— operation"
      productName_ja: product.name_ja,
      operationName: product._operation || '',
      keyIFS: product.keyIFS,
      docCode: product.docCode,
      lotNumber: `L${reportDate.replace(/-/g, '')}-${machineId.substring(0, 6)}-S${shiftIdx + 1}R${product._step || newEntries[shiftIdx].productEntries.length + 1}`,
      planQty,
      okCount: 0,
      ngTest: 0,
      ng: 0,
      ngPending: 0,
      ngReasonId: null,
      ifsSynced: false,
      rootCauseId: null,
      countermeasureId: null,
    };
    newEntries[shiftIdx].productEntries.push(newEntry);
    setShifts(newEntries);
    setProductModalCtx(null);
  };

  const updateProductField = (shiftIdx, entryIdx, field, value) => {
    const newShifts = [...shifts];
    newShifts[shiftIdx].productEntries[entryIdx] = {
      ...newShifts[shiftIdx].productEntries[entryIdx],
      [field]: value,
    };
    setShifts(newShifts);
  };

  const removeProductEntry = (shiftIdx, entryIdx) => {
    const newShifts = [...shifts];
    newShifts[shiftIdx].productEntries.splice(entryIdx, 1);
    setShifts(newShifts);
  };

  const updateDowntimeMin = (shiftIdx, entryIdx, minutes) => {
    const newShifts = [...shifts];
    newShifts[shiftIdx].downtimeEntries[entryIdx].minutes = parseInt(minutes) || 0;
    setShifts(newShifts);
  };

  const toggleDowntimeReason = (shiftIdx, reasonId) => {
    const newShifts = [...shifts];
    const entries = newShifts[shiftIdx].downtimeEntries;
    const existing = entries.findIndex(e => e.reasonId === reasonId);
    if (existing >= 0) {
      entries.splice(existing, 1);
    } else {
      const reason = downtimeReasons.find(r => r.id === reasonId);
      entries.push({ reasonId, minutes: reason?.defaultMin || 5 });
    }
    setShifts(newShifts);
  };

  const updateShiftField = (shiftIdx, field, value) => {
    const newShifts = [...shifts];
    newShifts[shiftIdx][field] = value;
    setShifts(newShifts);
  };

  const handleSave = (asSubmit) => {
    const newReport = {
      id: existingReport?.id || `RPT-${reportDate.replace(/-/g, '')}-${machineId}`,
      date: reportDate,
      machineId,
      machineName: machine.name,
      line: machine.line,
      dept: machine.dept,
      shifts,
      status: asSubmit ? 'submitted' : 'draft',
      createdBy: user.id,
      createdAt: existingReport?.createdAt || new Date().toISOString(),
      submittedAt: asSubmit ? new Date().toISOString() : null,
      approvedByLeader: null,
      approvedByLeaderAt: null,
      approvedByChief: null,
      approvedByChiefAt: null,
      rejectReason: null,
      ifsSynced: false,
      ifsSyncedAt: null,
    };
    if (isEdit) {
      setReports(reports.map(r => r.id === newReport.id ? newReport : r));
    } else {
      setReports([newReport, ...reports]);
    }
    onBack();
  };

  // Summary
  const summary = useMemo(() => {
    let plan = 0, ok = 0, ngAll = 0, dt = 0;
    shifts.forEach(sh => {
      sh.productEntries.forEach(pe => {
        plan += pe.planQty || 0;
        ok += pe.okCount || 0;
        const defectNG = (pe.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
        ngAll += (pe.ngTest || 0) + (defectNG || pe.ng || 0) + (pe.ngPending || 0);
      });
      sh.downtimeEntries.forEach(de => { dt += de.minutes || 0; });
    });
    return { plan, ok, ngAll, dt, ach: plan > 0 ? Math.round((ok / plan) * 100) : 0 };
  }, [shifts]);

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
            <div>
              <div className="text-xs text-slate-500 uppercase">{t.bm02Code}</div>
              <h2 className="text-xl font-bold text-slate-800">{t.bm02Title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleSave(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-100 flex items-center gap-2">
              <Save className="w-4 h-4" /> {t.save}
            </button>
            <button onClick={() => handleSave(true)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 flex items-center gap-2">
              <Send className="w-4 h-4" /> {t.submit}
            </button>
          </div>
        </div>

        {/* Header fields */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">{t.department}</label>
            <div className="mt-1 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm">{user.dept || machine?.dept || '—'}</div>
          </div>
          <div>
            <label className="text-xs text-slate-500">{t.reportDate}</label>
            <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t.machine}</label>
            <div className="mt-1 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm">{machine?.name || machineId || '—'}</div>
          </div>
          <div>
            <label className="text-xs text-slate-500">{t.productionLine}</label>
            <div className="mt-1 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm">{user.line || machine?.line || '—'}</div>
          </div>
        </div>

        {/* Capacity info */}
        <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
          <div className="bg-blue-50 rounded-lg p-2">
            <div className="text-slate-500">Ca 1 {t.capacity}</div>
            <div className="font-semibold text-blue-700">{machine?.shift1Cap} × {machine?.rate} = {Math.floor(machine?.shift1Cap * machine?.rate)}</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-2">
            <div className="text-slate-500">Ca 2 {t.capacity}</div>
            <div className="font-semibold text-blue-700">{machine?.shift2Cap} × {machine?.rate} = {Math.floor(machine?.shift2Cap * machine?.rate)}</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-2">
            <div className="text-slate-500">Ca 3 {t.capacity}</div>
            <div className="font-semibold text-blue-700">{machine?.shift3Cap} × {machine?.rate} = {Math.floor(machine?.shift3Cap * machine?.rate)}</div>
          </div>
          <div className="bg-emerald-50 rounded-lg p-2">
            <div className="text-slate-500">{t.total} {t.achievementRate}</div>
            <div className="font-semibold text-emerald-700">{summary.ok} / {summary.plan} = {summary.ach}%</div>
          </div>
        </div>
      </div>

      {/* Shift tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="flex border-b border-slate-200">
          {[0, 1, 2].map(i => (
            <button
              key={i}
              onClick={() => setActiveShift(i)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition ${
                activeShift === i ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50/50' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.shift} {i + 1} · {shifts[i].productEntries.length} SP
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {/* Operator & Leader for this shift */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">{t.shiftOperator}</label>
              <select
                value={shifts[activeShift].operatorId}
                onChange={e => {
                  const u = getUserById(e.target.value);
                  updateShiftField(activeShift, 'operatorId', e.target.value);
                  updateShiftField(activeShift, 'operatorName', u?.name || '');
                }}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
              >
                <option value="">-- {t.selectUser} --</option>
                {getTeamOperators(machine?.dept, shifts[activeShift].shiftNumber).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t.shiftLeader}</label>
              <select
                value={shifts[activeShift].leaderId}
                onChange={e => {
                  const u = getUserById(e.target.value);
                  updateShiftField(activeShift, 'leaderId', e.target.value);
                  updateShiftField(activeShift, 'leaderName', u?.name || '');
                }}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
              >
                <option value="">-- {t.selectUser} --</option>
                {mockUsers.filter(u => u.role === 'team_leader').map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.dept})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Product entries */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-700">Sản phẩm ({shifts[activeShift].productEntries.length})</h3>
              <button
                onClick={() => addProductEntry(activeShift)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700"
              >
                <Plus className="w-3.5 h-3.5" /> {t.addProduct}
              </button>
            </div>
            <div className="space-y-2">
              {shifts[activeShift].productEntries.map((entry, ei) => (
                <div key={entry.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{entry.productCode} · {entry[`productName_${lang}`]}</div>
                      <div className="text-xs text-slate-500 flex gap-3">
                        <span>IFS: {entry.keyIFS}</span>
                        <span>Doc: {entry.docCode}</span>
                      </div>
                    </div>
                    <button onClick={() => removeProductEntry(activeShift, ei)} className="p-1 text-rose-500 hover:bg-rose-50 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                    <div>
                      <label className="text-slate-500">{t.lotNumber}</label>
                      <input value={entry.lotNumber} onChange={e => updateProductField(activeShift, ei, 'lotNumber', e.target.value)}
                        className="mt-0.5 w-full px-2 py-1 rounded border border-slate-200" />
                    </div>
                    <div>
                      <label className="text-slate-500">{t.planQty}</label>
                      <input type="number" value={entry.planQty} onChange={e => updateProductField(activeShift, ei, 'planQty', parseInt(e.target.value) || 0)}
                        className="mt-0.5 w-full px-2 py-1 rounded border border-slate-200 text-right" />
                    </div>
                    <div>
                      <label className="text-emerald-600 font-medium">OK</label>
                      <input type="number" value={entry.okCount} onChange={e => updateProductField(activeShift, ei, 'okCount', parseInt(e.target.value) || 0)}
                        className="mt-0.5 w-full px-2 py-1 rounded border border-emerald-200 text-right font-medium text-emerald-700" />
                    </div>
                    <div>
                      <label className="text-amber-600">NG TEST</label>
                      <input type="number" value={entry.ngTest} onChange={e => updateProductField(activeShift, ei, 'ngTest', parseInt(e.target.value) || 0)}
                        className="mt-0.5 w-full px-2 py-1 rounded border border-amber-200 text-right text-amber-700" />
                    </div>
                    <div>
                      <label className="text-rose-600">NG {t.total}</label>
                      <div className="mt-0.5 px-2 py-1 rounded bg-rose-50 text-right text-rose-700 font-medium">
                        {((entry.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0) || entry.ng || 0) + (entry.ngTest || 0) + (entry.ngPending || 0)}
                      </div>
                    </div>
                    <div>
                      <label className="text-slate-500">{t.ngPendingCount}</label>
                      <input type="number" value={entry.ngPending} onChange={e => updateProductField(activeShift, ei, 'ngPending', parseInt(e.target.value) || 0)}
                        className="mt-0.5 w-full px-2 py-1 rounded border border-slate-200 text-right" />
                    </div>
                  </div>
                </div>
              ))}
              {shifts[activeShift].productEntries.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-6 border-2 border-dashed border-slate-200 rounded-lg">
                  {t.noData}
                </div>
              )}
            </div>
          </div>

          {/* 14 Downtime reasons */}
          <div>
            <h3 className="font-semibold text-slate-700 mb-2">{t.downtimeTitle} · 14 {t.downtimeReason}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {downtimeReasons.map(reason => {
                const existingIdx = shifts[activeShift].downtimeEntries.findIndex(e => e.reasonId === reason.id);
                const existing = existingIdx >= 0 ? shifts[activeShift].downtimeEntries[existingIdx] : null;
                return (
                  <div key={reason.id} className={`flex items-center gap-2 p-2 rounded-lg border ${existing ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                    <input type="checkbox" checked={!!existing} onChange={() => toggleDowntimeReason(activeShift, reason.id)}
                      className="w-4 h-4" />
                    <span className="text-xs flex-1 text-slate-700">{reason.id}. {reason[`name_${lang}`]}</span>
                    {existing && (
                      <input type="number" value={existing.minutes}
                        onChange={e => updateDowntimeMin(activeShift, existingIdx, e.target.value)}
                        className="w-14 px-2 py-0.5 rounded border border-slate-200 text-xs text-right" />
                    )}
                    <span className="text-xs text-slate-500">{t.min}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-slate-600 text-right">
              {t.total}: <span className="font-semibold text-slate-800">
                {shifts[activeShift].downtimeEntries.reduce((s, e) => s + e.minutes, 0)} {t.min}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Product selection modal */}
      <ModalSelect
        open={showProductModal}
        title={t.selectProduct}
        options={compatibleProducts}
        onSelect={handleSelectProduct}
        onClose={() => { setShowProductModal(false); setProductModalCtx(null); }}
        lang={lang}
      />
    </div>
  );
};

// ============================================================================
// UI: REPORT DETAIL (read-only view + approval actions)
// ============================================================================
// Per-shift approval model:
//   - Sub Leader approves/rejects each shift INDEPENDENTLY.
//   - Once all 3 shifts are leader_approved, the report auto-promotes to
//     leader_approved and Ast/Chief can approve/reject the whole day report.
// ============================================================================
const ReportDetail = ({ report, user, reports, setReports, t, lang, onBack, onEdit }) => {
  const summary = useMemo(() => calcReportSummary(report), [report]);
  const machine = getMachineById(report.machineId);
  // rejectCtx tracks what we're rejecting: 'report' (chief) or { shiftIdx } (leader)
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCtx, setRejectCtx] = useState(null);

  const isLeader = user.role === 'team_leader';
  const isChief = user.role === 'section_manager';
  // Each Sub Leader only approves shifts whose shiftNumber matches their own.
  // (Dept scoping happens naturally via the reports list; the shift constraint
  // here prevents e.g. the Ca 1 leader from approving a Ca 2 submission.)
  const canLeaderTouchShift = (sh) =>
    isLeader &&
    sh.status === 'submitted' &&
    (!user.shiftNumber || sh.shiftNumber === user.shiftNumber);
  // Chief can approve/reject the whole report once it reaches leader_approved
  const canChiefApprove = isChief && report.status === 'leader_approved';
  // Edit rules: operators/leaders can edit when in draft/rejected/submitted stage
  // Sub-leaders can also edit shifts they manage (pen button)
  // ★ Per-shift model: an operator can edit if THEIR OWN shift is still draft/rejected,
  //   even if the overall report status is 'submitted' (because another shift was submitted).
  const userOwnShift = user.shiftNumber ? (report.shifts || [])[user.shiftNumber - 1] : null;
  const ownShiftNeedsWork = userOwnShift && ['draft', 'rejected'].includes(userOwnShift.status || 'draft');
  const isOperatorLike = user.role === 'operator' || (user.role === 'team_leader' && !!user.machineId);
  const canEdit =
    report.status === 'draft' ||
    report.status === 'rejected' ||
    // Operator/Sub Leader can edit when their own shift still needs work
    (ownShiftNeedsWork && isOperatorLike) ||
    (isLeader && ['submitted', 'leader_approved', 'rejected'].includes(report.status));

  // Withdraw: operator can recall ONLY their own shift if it hasn't been approved by sub-leader yet
  // Find the user's own shift(s) — by operatorId match
  const userOwnShifts = (report.shifts || []).map((sh, idx) => ({ sh, idx })).filter(({ sh }) => sh.operatorId === user.id);
  // User can withdraw if they have at least one shift in submitted (not yet approved)
  const withdrawableShifts = userOwnShifts.filter(({ sh }) => sh.status === 'submitted');
  const canWithdraw = withdrawableShifts.length > 0;

  // Withdraw modal state (replaces window.confirm)
  const [withdrawCtx, setWithdrawCtx] = useState(null); // { shiftIdx } or null

  const handleWithdraw = () => {
    if (!withdrawCtx) return;
    const { shiftIdx } = withdrawCtx;
    const updated = {
      ...report,
      shifts: report.shifts.map((sh, i) => (
        i === shiftIdx
          ? { ...sh, status: 'draft', approvedByLeader: null, approvedByLeaderAt: null, rejectReason: null }
          : sh
      )),
    };
    setWithdrawCtx(null);
    persistUpdatedReport(updated);
  };

  // Recompute and persist the updated report so top-level status is derived correctly
  // ★ Dùng functional updater để tránh stale closure
  const persistUpdatedReport = (updated) => {
    const withStatus = { ...updated, status: deriveReportStatus(updated) };
    setReports(prev => prev.map(r => r.id === report.id ? withStatus : r));
  };

  // Approve a single shift (leader action)
  const handleLeaderApproveShift = (shiftIdx) => {
    const now = new Date().toISOString();
    const updated = {
      ...report,
      shifts: report.shifts.map((sh, i) => (
        i === shiftIdx
          ? { ...sh, status: 'leader_approved', approvedByLeader: user.id, approvedByLeaderAt: now, rejectReason: null }
          : sh
      )),
      rejectedBy: null, // clear any report-level rejection context
    };
    persistUpdatedReport(updated);
  };

  // Reject a single shift (leader action) — stores rejection history
  const handleLeaderRejectShift = (shiftIdx, reason) => {
    const now = new Date().toISOString();
    const updated = {
      ...report,
      shifts: report.shifts.map((sh, i) => {
        if (i !== shiftIdx) return sh;
        const history = [...(sh.rejectionHistory || [])];
        history.push({
          reason,
          rejectedBy: user.id,
          rejectedByName: user.name,
          rejectedAt: now,
          resubmittedAt: null,
        });
        return { ...sh, status: 'rejected', approvedByLeader: null, approvedByLeaderAt: null, rejectReason: reason, rejectionHistory: history };
      }),
      rejectedBy: 'leader',
    };
    persistUpdatedReport(updated);
  };

  // Chief-level actions (operate on the whole report once all 3 shifts are approved)
  const handleChiefApprove = () => {
    const now = new Date().toISOString();
    const updated = {
      ...report,
      approvedByChief: user.id,
      approvedByChiefAt: now,
      // Mark all shifts as finalized
      shifts: report.shifts.map(sh => ({ ...sh, status: 'leader_approved' })),
    };
    persistUpdatedReport(updated);
    onBack();
  };

  const handleChiefReject = (reason) => {
    // Chief reject: mark report as rejected; operators will need to resubmit
    const updated = {
      ...report,
      status: 'rejected',
      rejectReason: reason,
      rejectedBy: 'chief',
      // Reset shifts back to draft so operators can fix
      shifts: report.shifts.map(sh => ({ ...sh, status: 'draft', approvedByLeader: null, approvedByLeaderAt: null, rejectReason: reason })),
    };
    setReports(prev => prev.map(r => r.id === report.id ? updated : r));
    onBack();
  };

  const handleReject = () => {
    if (!rejectCtx) return;
    if (rejectCtx === 'report') {
      handleChiefReject(rejectReason);
    } else {
      handleLeaderRejectShift(rejectCtx.shiftIdx, rejectReason);
    }
    setRejectCtx(null);
    setRejectReason('');
  };

  // Derive per-shift approval counters for the approval chain display
  const approvedShiftCount = (report.shifts || []).filter(s => s.status === 'leader_approved').length;
  const totalShiftCount = (report.shifts || []).length;

  const handleSyncIFS = () => {
    const updated = { ...report, ifsSynced: true, ifsSyncedAt: new Date().toISOString() };
    setReports(prev => prev.map(r => r.id === report.id ? updated : r));
  };

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
            <div>
              <div className="text-xs text-slate-500 font-mono">{report.id}</div>
              <h2 className="text-xl font-bold text-slate-800">{t.bm02Title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={report.status} t={t} report={report} user={user} />
            {canWithdraw && withdrawableShifts.length === 1 && (
              <button onClick={() => setWithdrawCtx({ shiftIdx: withdrawableShifts[0].idx })} className="px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 text-amber-700 text-xs hover:bg-amber-100 flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />{t.withdraw} (Ca {withdrawableShifts[0].sh.shiftNumber})</button>
            )}
            {canWithdraw && withdrawableShifts.length > 1 && withdrawableShifts.map(({ sh, idx }) => (
              <button key={idx} onClick={() => setWithdrawCtx({ shiftIdx: idx })} className="px-3 py-1.5 rounded-lg border border-amber-400 bg-amber-50 text-amber-700 text-xs hover:bg-amber-100 flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />{t.withdraw} (Ca {sh.shiftNumber})</button>
            ))}
            {canEdit && <button onClick={() => onEdit(report)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs hover:bg-slate-100 flex items-center gap-1"><Edit2 className="w-3.5 h-3.5" />{t.edit}</button>}
            {canChiefApprove && (
              <>
                <button onClick={() => { setRejectCtx('report'); setRejectReason(''); }} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs hover:bg-rose-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{t.reject}</button>
                <button onClick={handleChiefApprove} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />{t.approve} (Chief)</button>
              </>
            )}
            {report.status === 'chief_approved' && !report.ifsSynced && (
              <button onClick={handleSyncIFS} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700 flex items-center gap-1"><Upload className="w-3.5 h-3.5" />{t.ifsPushData}</button>
            )}
          </div>
        </div>

        {/* Header info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-slate-500">{t.department}</div><div className="font-medium">{report.dept}</div></div>
          <div><div className="text-xs text-slate-500">{t.reportDate}</div><div className="font-medium">{fmtDate(report.date)}</div></div>
          <div><div className="text-xs text-slate-500">{t.machine}</div><div className="font-medium">{report.machineId}</div></div>
          <div><div className="text-xs text-slate-500">{t.productionLine}</div><div className="font-medium">{report.line}</div></div>
        </div>

        {/* Summary */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-blue-50 rounded-lg p-3"><div className="text-xs text-slate-500">{t.planQty}</div><div className="text-lg font-bold text-blue-700">{summary.totalPlan}</div></div>
          <div className="bg-emerald-50 rounded-lg p-3"><div className="text-xs text-slate-500">OK</div><div className="text-lg font-bold text-emerald-700">{summary.totalOK}</div></div>
          <div className="bg-rose-50 rounded-lg p-3"><div className="text-xs text-slate-500">NG ({t.total})</div><div className="text-lg font-bold text-rose-700">{summary.totalNGAll}</div></div>
          <div className="bg-amber-50 rounded-lg p-3"><div className="text-xs text-slate-500">{t.downtimeTotal}</div><div className="text-lg font-bold text-amber-700">{summary.totalDowntime} {t.min}</div></div>
          <div className="bg-purple-50 rounded-lg p-3"><div className="text-xs text-slate-500">{t.achievementRate}</div><div className="text-lg font-bold text-purple-700">{summary.achievement}%</div></div>
        </div>

        {/* Rejection banner */}
        {report.status === 'rejected' && report.rejectReason && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-rose-800">{t.rejected}</div>
              <div className="text-xs text-rose-700">{report.rejectReason}</div>
            </div>
          </div>
        )}

        {/* Approval chain: operator shifts → leader approves each shift → chief finalizes day */}
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-600 flex-wrap">
          <div className={`flex items-center gap-1 px-2 py-1 rounded ${approvedShiftCount === totalShiftCount ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            <CheckCircle className="w-3 h-3" /> Sub Leader {approvedShiftCount}/{totalShiftCount} {t.approvedShiftsTag}
          </div>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <div className={`flex items-center gap-1 px-2 py-1 rounded ${report.approvedByChief ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100'}`}>
            <CheckCircle className="w-3 h-3" /> Ast Chief {report.approvedByChief ? `✓ ${getUserById(report.approvedByChief)?.name}` : '...'}
          </div>
          {report.ifsSynced && (
            <>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <div className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 text-indigo-700">
                <Database className="w-3 h-3" /> IFS ✓
              </div>
            </>
          )}
        </div>
        {/* Per-shift status pills */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {(report.shifts || []).map((sh, si) => {
            const statusStyle = {
              draft: 'bg-slate-100 text-slate-600 border-slate-300',
              submitted: 'bg-blue-50 text-blue-700 border-blue-300',
              leader_approved: 'bg-emerald-50 text-emerald-700 border-emerald-300',
              rejected: 'bg-rose-50 text-rose-700 border-rose-300',
            }[sh.status || 'draft'];
            const statusLabel = {
              draft: lang === 'vi' ? 'Nháp' : '下書き',
              submitted: lang === 'vi' ? 'Chờ SL' : 'SL承認待',
              leader_approved: lang === 'vi' ? 'SL đã duyệt' : 'SL承認済',
              rejected: lang === 'vi' ? 'Từ chối' : '却下',
            }[sh.status || 'draft'];
            return (
              <div key={si} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium ${statusStyle}`}>
                <span className="font-bold">Ca {sh.shiftNumber}</span>
                <span>·</span>
                <span>{statusLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shifts detail */}
      {report.shifts?.map((sh, si) => {
        const canReviewThisShift = canLeaderTouchShift(sh);
        const shiftStatusStyle = {
          draft: 'bg-slate-100 text-slate-600 border-slate-300',
          submitted: 'bg-blue-50 text-blue-700 border-blue-300',
          leader_approved: 'bg-emerald-50 text-emerald-700 border-emerald-300',
          rejected: 'bg-rose-50 text-rose-700 border-rose-300',
        }[sh.status || 'draft'];
        const shiftStatusLabel = {
          draft: lang === 'vi' ? 'Nháp' : '下書き',
          submitted: lang === 'vi' ? 'Chờ duyệt' : '承認待ち',
          leader_approved: lang === 'vi' ? 'Đã duyệt' : '承認済',
          rejected: lang === 'vi' ? 'Từ chối' : '却下',
        }[sh.status || 'draft'];
        return (
        <div key={si} className={`bg-white rounded-xl p-5 shadow-sm border ${canReviewThisShift ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">{t.shift} {sh.shiftNumber}</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${shiftStatusStyle}`}>
                {shiftStatusLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-500">
                {t.shiftOperator}: <span className="font-medium text-slate-700">{sh.operatorName}</span> ·
                {' '}{t.shiftLeader}: <span className="font-medium text-slate-700">{sh.leaderName}</span>
              </div>
              {canReviewThisShift && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setRejectCtx({ shiftIdx: si }); setRejectReason(''); }}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs hover:bg-rose-700 flex items-center gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" />{t.reject}
                  </button>
                  <button
                    onClick={() => handleLeaderApproveShift(si)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700 flex items-center gap-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />{t.approve}
                  </button>
                </div>
              )}
              {isLeader && !canReviewThisShift && ['submitted', 'leader_approved', 'rejected'].includes(sh.status) && (
                <button
                  onClick={() => onEdit(report)}
                  className="px-2 py-1.5 rounded-lg border border-slate-300 text-xs hover:bg-slate-100 flex items-center gap-1"
                  title={t.edit}
                >
                  <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                </button>
              )}
            </div>
          </div>
          {sh.status === 'leader_approved' && sh.approvedByLeader && (
            <div className="mb-3 p-2 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{lang === 'vi' ? 'Sub Leader đã duyệt' : 'SL承認済'}: {getUserById(sh.approvedByLeader)?.name} · {sh.approvedByLeaderAt ? new Date(sh.approvedByLeaderAt).toLocaleString() : ''}</span>
            </div>
          )}
          {sh.status === 'rejected' && sh.rejectReason && (
            <div className="mb-3 p-2 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">{lang === 'vi' ? 'Đã bị từ chối' : '却下'}</div>
                <div>{sh.rejectReason}</div>
              </div>
            </div>
          )}
          {/* Rejection history timeline */}
          {(sh.rejectionHistory || []).length > 0 && (
            <div className="mb-3 p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <div className="font-semibold text-slate-600 mb-1.5">{t.rejectionHistory} ({sh.rejectionHistory.length})</div>
              <div className="space-y-1.5">
                {sh.rejectionHistory.map((entry, hi) => (
                  <div key={hi} className="flex items-start gap-2 pl-2 border-l-2 border-rose-300">
                    <div className="flex-1">
                      <div className="text-rose-700 font-medium">{entry.reason}</div>
                      <div className="text-slate-500">
                        {t.rejectedByLabel}: {entry.rejectedByName || '?'} · {entry.rejectedAt ? new Date(entry.rejectedAt).toLocaleString() : ''}
                        {entry.resubmittedAt && (
                          <span className="ml-2 text-blue-600">→ {t.resubmittedAt}: {new Date(entry.resubmittedAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Products table */}
          {sh.productEntries?.length > 0 && (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    <th className="p-2">{t.productCode}</th>
                    <th className="p-2">{t.lotNumber}</th>
                    <th className="p-2 text-right">{t.planQty}</th>
                    <th className="p-2 text-right text-emerald-700">OK</th>
                    <th className="p-2 text-right text-amber-700">NG TEST</th>
                    <th className="p-2 text-right text-rose-700">NG</th>
                    <th className="p-2 text-right">{t.ngPendingCount}</th>
                    <th className="p-2">{t.ngReason}</th>
                    <th className="p-2 text-center">IFS</th>
                  </tr>
                </thead>
                <tbody>
                  {sh.productEntries.map(pe => {
                    const peDefectNG = (pe.defectEntries || []).reduce((s, d) => s + (d.quantity || 0), 0);
                    return (
                    <tr key={pe.id} className="border-t border-slate-100">
                      <td className="p-2"><div className="font-semibold text-slate-800">{pe.productCode}</div><div className="text-slate-500">{pe[`productName_${lang}`]}</div></td>
                      <td className="p-2 font-mono text-slate-600">{pe.lotNumber}</td>
                      <td className="p-2 text-right">{pe.planQty}</td>
                      <td className="p-2 text-right text-emerald-700 font-medium">{pe.okCount}</td>
                      <td className="p-2 text-right text-amber-700">{pe.ngTest}</td>
                      <td className="p-2 text-right text-rose-700">{peDefectNG || pe.ng || 0}</td>
                      <td className="p-2 text-right">{pe.ngPending}</td>
                      <td className="p-2 text-slate-600">
                        {(peDefectNG || pe.ng || 0) > 0
                          ? ((pe.defectEntries || []).length > 0
                            ? `${(pe.defectEntries || []).length} ${t.defectSummary}`
                            : (pe.ngReasonId ? `${pe.ngReasonId} · ${getNGReasonName(pe.ngReasonId, lang)}` : '-'))
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="p-2 text-center">{pe.ifsSynced ? <CheckCircle className="w-4 h-4 text-emerald-500 inline" /> : <XCircle className="w-4 h-4 text-slate-300 inline" />}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Downtime */}
          {sh.downtimeEntries?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">{t.downtimeTitle}</div>
              <div className="flex flex-wrap gap-1.5">
                {sh.downtimeEntries.map((de, di) => (
                  <span key={di} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-xs border border-amber-200">
                    {de.reasonId}. {getDowntimeReasonName(de.reasonId, lang)} · <strong>{de.minutes}{t.min}</strong>
                  </span>
                ))}
              </div>
              <div className="text-xs text-slate-500 mt-1 text-right">
                {t.total}: {sh.downtimeEntries.reduce((s, e) => s + e.minutes, 0)} {t.min}
              </div>
            </div>
          )}
        </div>
        );
      })}

      {/* Reject modal */}
      {rejectCtx && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl">
            <h3 className="font-semibold text-slate-800 mb-2">
              {t.reject}
              {rejectCtx !== 'report' && ` · Ca ${rejectCtx.shiftIdx + 1}`}
            </h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Lý do..." rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button onClick={() => { setRejectCtx(null); setRejectReason(''); }} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">{t.cancel}</button>
              <button onClick={handleReject} disabled={!rejectReason.trim()} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm disabled:opacity-50">{t.reject}</button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw confirmation modal */}
      {withdrawCtx && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <RotateCcw className="w-5 h-5 text-amber-600" />
              <h3 className="font-semibold text-slate-800">
                {t.withdraw} · Ca {(report.shifts[withdrawCtx.shiftIdx]?.shiftNumber) || (withdrawCtx.shiftIdx + 1)}
              </h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">{t.withdrawConfirm}</p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setWithdrawCtx(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">{t.cancel}</button>
              <button onClick={handleWithdraw} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm hover:bg-amber-700">{t.withdraw}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// UI: MONTHLY PLAN CALENDAR (BM-01 LAYOUT)
// ============================================================================
const MonthlyPlanPage = ({ t, lang }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedMachine, setSelectedMachine] = useState(machines[0].id);

  const plans = useMemo(() => generateMonthlyPlan(year, month), [year, month]);
  const filteredPlans = plans.filter(p => p.machineId === selectedMachine);
  const daysInMonth = new Date(year, month, 0).getDate();
  const machine = getMachineById(selectedMachine);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs text-slate-500 uppercase">{t.bm01Code}</div>
            <h2 className="text-xl font-bold text-slate-800">{t.bm01Title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t.companyName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-semibold">
              {pad2(month)} / {year}
            </div>
            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-600">{t.selectMachine}:</label>
          <select value={selectedMachine} onChange={e => setSelectedMachine(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
            {machines.map(m => <option key={m.id} value={m.id}>{m.id} · {m.line}</option>)}
          </select>
          <div className="text-xs text-slate-500 flex items-center gap-4">
            <span>Ca 1: {machine?.shift1Cap}</span>
            <span>Ca 2: {machine?.shift2Cap}</span>
            <span>Ca 3: {machine?.shift3Cap}</span>
            <span>Rate: {machine?.rate}</span>
          </div>
        </div>
      </div>

      {/* Plan table with 31-day calendar grid */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-600 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left sticky left-0 bg-slate-100 min-w-[200px]">{t.productCode} / {t.productName}</th>
                <th className="px-2 py-2 text-left min-w-[100px]">{t.keyIFS}</th>
                <th className="px-2 py-2 text-left">{t.docCode}</th>
                <th className="px-2 py-2 text-right">CT</th>
                <th className="px-2 py-2 text-right">{t.csCoDelivery}</th>
                <th className="px-2 py-2 text-right">{t.csActualDelivery}</th>
                <th className="px-2 py-2 text-center" colSpan={daysInMonth}>{t.dailyPlanActual}</th>
              </tr>
              <tr className="bg-slate-50 text-[10px]">
                <th colSpan={6}></th>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                  <th key={d} className="px-1 py-1 text-center w-8 border-l border-slate-200">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map((plan, pi) => (
                <React.Fragment key={pi}>
                  <tr className="border-t border-slate-200 bg-blue-50/30">
                    <td className="px-2 py-1.5 sticky left-0 bg-blue-50/60">
                      <div className="font-semibold text-slate-800">{plan.productCode}</div>
                      <div className="text-slate-600 text-[10px]">{plan[`productName_${lang}`]}</div>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-600">{plan.keyIFS}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-600">{plan.docCode}</td>
                    <td className="px-2 py-1.5 text-right">{plan.ct}</td>
                    <td className="px-2 py-1.5 text-right">{plan.csCoDelivery}</td>
                    <td className="px-2 py-1.5 text-right">{plan.csActualDelivery}</td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                      const dp = plan.dailyPlans[pad2(d)];
                      return (
                        <td key={d} className="p-0.5 text-center border-l border-slate-100 relative">
                          {dp ? (
                            <div>
                              <div className="text-[10px] text-slate-500">{dp.plan}</div>
                              <div className="text-[10px] font-semibold text-emerald-700">{dp.actual}</div>
                              {/* OT indicator: show only on first product row of this machine/day */}
                              {pi === 0 && dp.otOverride === 'on' && (
                                <div className="absolute top-0 right-0 w-2 h-2 rounded-full bg-purple-500" title={`OT: ${dp.otPlannedMinutes || 0} min`}></div>
                              )}
                              {pi === 0 && dp.otOverride === 'off' && (
                                <div className="absolute top-0 right-0 w-2 h-2 rounded-full bg-slate-300" title="OT off"></div>
                              )}
                            </div>
                          ) : (
                            <div className="text-slate-300 text-[10px]">-</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              ))}
              {/* OT plan summary row per machine */}
              {filteredPlans.length > 0 && (
                <tr className="border-t-2 border-purple-200 bg-purple-50/30">
                  <td className="px-2 py-1.5 sticky left-0 bg-purple-50/60" colSpan={6}>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-purple-600" />
                      <span className="font-semibold text-purple-800 text-[11px]">
                        {t.otPlanLabel} ({machine?.id})
                      </span>
                    </div>
                  </td>
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                    const dp = filteredPlans[0]?.dailyPlans[pad2(d)];
                    const override = dp?.otOverride;
                    const mins = dp?.otPlannedMinutes || 0;
                    return (
                      <td key={d} className="p-0.5 text-center border-l border-purple-100">
                        {override === 'on' && mins > 0 && (
                          <div className="text-[9px] font-bold text-purple-700 bg-purple-100 rounded px-0.5">
                            {mins}
                          </div>
                        )}
                        {override === 'off' && (
                          <div className="text-[9px] font-bold text-slate-400">off</div>
                        )}
                        {(override == null || override === undefined) && dp && (
                          <div className="text-[9px] text-slate-300">·</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
              {filteredPlans.length === 0 && (
                <tr><td colSpan={6 + daysInMonth} className="px-4 py-8 text-center text-slate-400">{t.noData}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* OT legend */}
      <div className="bg-white rounded-xl p-3 text-xs text-slate-700 border border-slate-200 flex flex-wrap items-center gap-4">
        <span className="font-semibold text-slate-800">{t.otPlanLegend}:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-purple-500"></span>
          <span>{lang === 'vi' ? 'Có OT theo kế hoạch' : '計画OTあり'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-slate-300"></span>
          <span>{lang === 'vi' ? 'Kế hoạch: không OT' : '計画: OTなし'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-slate-400">·</span>
          <span>{lang === 'vi' ? 'Theo setting tổ chức' : '組織設定に従う'}</span>
        </span>
      </div>

      <div className="bg-indigo-50 rounded-xl p-3 text-xs text-indigo-700 border border-indigo-200">
        <Info className="w-4 h-4 inline mr-1" />
        {lang === 'vi'
          ? 'Mock data - Dữ liệu được sinh ngẫu nhiên từ seed. Trong production sẽ lấy từ IFS ERP qua API theo Key IFS.'
          : 'モックデータ - シードから生成されています。本番環境ではIFS ERPからKey IFS経由で取得されます。'}
      </div>
    </div>
  );
};

// ============================================================================
// UI: APPROVALS PAGE
// ============================================================================
// Small pill showing an abnormality flag (ngHigh, downtimeLong, overtime, otNoReason)
const AbnormalityBadge = ({ flag, t }) => {
  const cfg = {
    ngHigh:       { label: t.flagNgHigh,        cls: 'bg-rose-100 text-rose-700 border-rose-300',    Icon: AlertTriangle },
    downtimeLong: { label: t.flagDowntimeLong,  cls: 'bg-amber-100 text-amber-700 border-amber-300', Icon: Clock },
    overtime:     { label: t.flagOvertime,      cls: 'bg-purple-100 text-purple-700 border-purple-300', Icon: Activity },
    otNoReason:   { label: t.flagOtNoReason,    cls: 'bg-rose-100 text-rose-700 border-rose-300',    Icon: Flag },
  }[flag.type] || { label: flag.type, cls: 'bg-slate-100 text-slate-600 border-slate-300', Icon: Info };
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cfg.cls}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
};

const ApprovalsPage = ({ user, reports, setReports, t, lang, onOpenReport }) => {
  const canApprove = user.role === 'team_leader' || user.role === 'section_manager';
  const isLeader = user.role === 'team_leader';

  // Filter: 'all' | 'normal' | 'abnormal'
  const [filter, setFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  // For leader: flatten per-shift pending items across reports (each waiting shift
  // is its own row). Each Sub Leader only sees shifts that match BOTH their
  // department AND their assigned shift number — e.g. the CNC Ca 2 leader only
  // sees shift-2 submissions from CNC machines, never shift 1 or shift 3.
  // For chief: show day-level reports awaiting leader_approved (chief approval).
  const pendingShifts = useMemo(() => {
    if (!isLeader) return [];
    const rows = [];
    reports
      .filter(r => r.dept === user.dept)
      .forEach(r => {
        (r.shifts || []).forEach((sh, si) => {
          if (sh.status !== 'submitted') return;
          // Match by shiftNumber if the leader has one (normal case for Sub Leader),
          // otherwise fall back to dept-only (safety for unassigned leader accounts).
          if (user.shiftNumber && sh.shiftNumber !== user.shiftNumber) return;
          rows.push({ report: r, shift: sh, shiftIdx: si });
        });
      });
    return rows;
  }, [reports, user, isLeader]);

  const pendingReports = useMemo(() => {
    if (isLeader) return [];
    return reports.filter(r => r.status === 'leader_approved');
  }, [reports, isLeader]);

  // Attach abnormality metadata to each pending item
  const enrichedPendingReports = useMemo(() => {
    return pendingReports.map(r => {
      const flags = getReportAbnormalities(r);
      const blocking = flags.some(f => f.blocking);
      return { report: r, flags, blocking, abnormal: flags.length > 0 };
    });
  }, [pendingReports]);
  const enrichedPendingShifts = useMemo(() => {
    return pendingShifts.map(item => {
      const flags = getReportAbnormalities(item.report);
      const blocking = flags.some(f => f.blocking);
      return { ...item, flags, blocking, abnormal: flags.length > 0 };
    });
  }, [pendingShifts]);

  // Apply the Normal/Abnormal filter
  const filteredChiefItems = useMemo(() => {
    if (filter === 'normal') return enrichedPendingReports.filter(x => !x.abnormal);
    if (filter === 'abnormal') return enrichedPendingReports.filter(x => x.abnormal);
    return enrichedPendingReports;
  }, [enrichedPendingReports, filter]);
  const filteredLeaderItems = useMemo(() => {
    if (filter === 'normal') return enrichedPendingShifts.filter(x => !x.abnormal);
    if (filter === 'abnormal') return enrichedPendingShifts.filter(x => x.abnormal);
    return enrichedPendingShifts;
  }, [enrichedPendingShifts, filter]);

  // Reset selection whenever the filter or underlying data changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, reports.length]);

  const pendingCount = isLeader ? pendingShifts.length : pendingReports.length;
  const normalCount = isLeader
    ? enrichedPendingShifts.filter(x => !x.abnormal).length
    : enrichedPendingReports.filter(x => !x.abnormal).length;
  const abnormalCount = isLeader
    ? enrichedPendingShifts.filter(x => x.abnormal).length
    : enrichedPendingReports.filter(x => x.abnormal).length;

  const history = useMemo(() => {
    return reports.filter(r => {
      if (isLeader) {
        return (r.shifts || []).some(sh => sh.approvedByLeader === user.id);
      }
      return r.approvedByChief === user.id;
    })
    .sort((a, b) => {
      const at = isLeader
        ? (a.shifts || []).reduce((max, s) => (s.approvedByLeaderAt && s.approvedByLeaderAt > max ? s.approvedByLeaderAt : max), '')
        : (a.approvedByChiefAt || '');
      const bt = isLeader
        ? (b.shifts || []).reduce((max, s) => (s.approvedByLeaderAt && s.approvedByLeaderAt > max ? s.approvedByLeaderAt : max), '')
        : (b.approvedByChiefAt || '');
      return bt.localeCompare(at);
    })
    .slice(0, 10);
  }, [reports, user, isLeader]);

  // =================== Row selection helpers ===================
  const toggleRow = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectableItems = isLeader
    ? filteredLeaderItems.filter(x => !x.blocking)
    : filteredChiefItems.filter(x => !x.blocking);
  const allSelectableSelected = selectableItems.length > 0 && selectableItems.every(x => {
    const key = isLeader ? `${x.report.id}-s${x.shiftIdx}` : x.report.id;
    return selectedIds.has(key);
  });
  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set();
      selectableItems.forEach(x => {
        const key = isLeader ? `${x.report.id}-s${x.shiftIdx}` : x.report.id;
        next.add(key);
      });
      setSelectedIds(next);
    }
  };

  // =================== Approval actions ===================
  // Chief: approve a set of whole reports at once
  const approveChiefReports = (reportIds) => {
    const now = new Date().toISOString();
    const ids = new Set(reportIds);
    setReports(prev => prev.map(r => {
      if (!ids.has(r.id)) return r;
      const updated = {
        ...r,
        approvedByChief: user.id,
        approvedByChiefAt: now,
        shifts: (r.shifts || []).map(sh => ({ ...sh, status: 'leader_approved' })),
      };
      updated.status = deriveReportStatus(updated);
      return updated;
    }));
  };

  // Leader: approve a set of (reportId, shiftIdx) pairs
  const approveLeaderShifts = (pairs) => {
    const now = new Date().toISOString();
    // group pairs by report id
    const byReport = new Map();
    pairs.forEach(p => {
      if (!byReport.has(p.reportId)) byReport.set(p.reportId, new Set());
      byReport.get(p.reportId).add(p.shiftIdx);
    });
    setReports(prev => prev.map(r => {
      const idxSet = byReport.get(r.id);
      if (!idxSet) return r;
      const updated = {
        ...r,
        shifts: (r.shifts || []).map((sh, i) => {
          if (!idxSet.has(i)) return sh;
          return {
            ...sh,
            status: 'leader_approved',
            approvedByLeader: user.id,
            approvedByLeaderAt: now,
            rejectReason: null,
          };
        }),
        rejectedBy: null,
      };
      updated.status = deriveReportStatus(updated);
      return updated;
    }));
  };

  const handleBulkApprove = () => {
    if (selectedIds.size === 0) return;
    if (isLeader) {
      const pairs = [];
      filteredLeaderItems.forEach(x => {
        const key = `${x.report.id}-s${x.shiftIdx}`;
        if (selectedIds.has(key)) pairs.push({ reportId: x.report.id, shiftIdx: x.shiftIdx });
      });
      approveLeaderShifts(pairs);
    } else {
      const ids = [];
      filteredChiefItems.forEach(x => {
        if (selectedIds.has(x.report.id)) ids.push(x.report.id);
      });
      approveChiefReports(ids);
    }
    setSelectedIds(new Set());
    setShowConfirm(false);
  };

  const handleQuickApproveAllNormal = () => {
    if (isLeader) {
      const pairs = enrichedPendingShifts
        .filter(x => !x.abnormal && !x.blocking)
        .map(x => ({ reportId: x.report.id, shiftIdx: x.shiftIdx }));
      if (pairs.length === 0) return;
      approveLeaderShifts(pairs);
    } else {
      const ids = enrichedPendingReports
        .filter(x => !x.abnormal && !x.blocking)
        .map(x => x.report.id);
      if (ids.length === 0) return;
      approveChiefReports(ids);
    }
    setSelectedIds(new Set());
  };

  const filterBtnClass = (key) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
      filter === key
        ? 'bg-slate-800 text-white'
        : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">{t.approvals}</h2>
          <p className="text-sm text-slate-500">
            {canApprove
              ? (isLeader
                  ? `${pendingCount} ${t.pendingShiftsTag}`
                  : `${pendingCount} ${t.pending}`)
              : t.noData}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">{t.approvalLevelNote}</p>
        </div>
      </div>

      {!canApprove && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 inline mr-1" />
          {lang === 'vi'
            ? 'Bạn không có quyền phê duyệt báo cáo. Vui lòng liên hệ Sub Leader hoặc Ast Chief.'
            : '承認権限がありません。Sub LeaderまたはAst Chiefに連絡してください。'}
        </div>
      )}

      {canApprove && (
        <>
          {/* Stats + bulk action bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button className={filterBtnClass('all')} onClick={() => setFilter('all')}>
                {t.filterAll} ({pendingCount})
              </button>
              <button className={filterBtnClass('normal')} onClick={() => setFilter('normal')}>
                <CheckCircle className="w-3.5 h-3.5 inline mr-1 text-emerald-600" />
                {t.filterNormal} ({normalCount})
              </button>
              <button className={filterBtnClass('abnormal')} onClick={() => setFilter('abnormal')}>
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-rose-600" />
                {t.filterAbnormal} ({abnormalCount})
              </button>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs text-slate-600">
                    {selectedIds.size} {t.selectedCount}
                  </span>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 flex items-center gap-1"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    {t.bulkApprove}
                  </button>
                </>
              )}
              {normalCount > 0 && (
                <button
                  onClick={handleQuickApproveAllNormal}
                  className="px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-emerald-600 text-white text-xs font-semibold hover:opacity-90 flex items-center gap-1 shadow"
                  title={t.quickApproveNormal}
                >
                  <Zap className="w-3.5 h-3.5" />
                  {t.quickApproveNormal} ({normalCount})
                </button>
              )}
            </div>
          </div>

          {/* Rule info banner (shown only when filter=abnormal or any abnormal exists) */}
          {abnormalCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-0.5">{t.manualReviewRequired}</div>
                <div>
                  {t.ruleNgHigh} · {t.ruleDowntimeLong} · {t.ruleOtUnreasoned}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {canApprove && isLeader && (
        <>
          {/* Per-shift pending list */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-amber-50/50 flex items-center gap-3">
              <input
                type="checkbox"
                checked={allSelectableSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-slate-300"
                disabled={selectableItems.length === 0}
              />
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800">
                  {t.needsConfirmation} ({filteredLeaderItems.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'vi'
                    ? 'Mỗi operator gửi báo cáo ca riêng. Sau khi bạn duyệt đủ 3 ca, báo cáo ngày sẽ chuyển đến Ast/Chief.'
                    : '各オペレータは自分の直の報告のみ提出します。3直すべてを承認すると、Ast/Chiefに送付されます。'}
                </p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredLeaderItems.map(({ report: r, shift: sh, shiftIdx, flags, blocking, abnormal }) => {
                const shSum = {
                  plan: sh.productEntries?.reduce((s, p) => s + (p.planQty || 0), 0) || 0,
                  ok: sh.productEntries?.reduce((s, p) => s + (p.okCount || 0), 0) || 0,
                  ng: sh.productEntries?.reduce((s, p) => {
                    const defectNG = (p.defectEntries || []).reduce((d, de) => d + (de.quantity || 0), 0);
                    return s + (defectNG || p.ng || 0) + (p.ngTest || 0) + (p.ngPending || 0);
                  }, 0) || 0,
                };
                const key = `${r.id}-s${shiftIdx}`;
                const checked = selectedIds.has(key);
                return (
                  <div key={key} className={`p-4 flex items-center gap-3 ${abnormal ? 'bg-rose-50/30' : 'hover:bg-blue-50/40'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => !blocking && toggleRow(key)}
                      disabled={blocking}
                      className="w-4 h-4 rounded border-slate-300 flex-shrink-0"
                      title={blocking ? t.bulkBlockedHint : ''}
                    />
                    <div className="w-12 h-12 rounded-lg bg-blue-100 flex flex-col items-center justify-center flex-shrink-0">
                      <div className="text-[9px] text-blue-600 font-semibold">Ca</div>
                      <div className="text-lg font-black text-blue-700 leading-none">{sh.shiftNumber}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{r.machineId}</span>
                        <span className="text-xs text-slate-500">· {r.line}</span>
                        <span className="text-xs text-slate-600">· {sh.operatorName}</span>
                        {!abnormal && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-300">
                            <CheckCircle className="w-3 h-3" /> {t.filterNormal}
                          </span>
                        )}
                        {flags.map((f, i) => <AbnormalityBadge key={i} flag={f} t={t} />)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {fmtDate(r.date)} · {t.planQty}: {shSum.plan} · OK: {shSum.ok} · NG: {shSum.ng}
                      </div>
                      {blocking && (
                        <div className="text-[11px] text-rose-600 mt-0.5">{t.bulkBlockedHint}</div>
                      )}
                    </div>
                    <button onClick={() => onOpenReport(r)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 flex-shrink-0">{t.view}</button>
                  </div>
                );
              })}
              {filteredLeaderItems.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">
                  {filter === 'normal' ? t.noNormalReports : filter === 'abnormal' ? t.noAbnormalReports : t.noPendingReports}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {canApprove && !isLeader && (
        <>
          {/* Chief: report-level list with checkboxes for bulk approval */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-purple-50/50 flex items-center gap-3">
              <input
                type="checkbox"
                checked={allSelectableSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-slate-300"
                disabled={selectableItems.length === 0}
              />
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800">{t.pending} ({filteredChiefItems.length})</h3>
                <p className="text-xs text-slate-500 mt-0.5">{t.allApprovedNotice}</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredChiefItems.map(({ report: r, flags, blocking, abnormal }) => {
                const s = calcReportSummary(r);
                const checked = selectedIds.has(r.id);
                return (
                  <div key={r.id} className={`p-4 flex items-center gap-3 ${abnormal ? 'bg-rose-50/30' : 'hover:bg-blue-50/40'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => !blocking && toggleRow(r.id)}
                      disabled={blocking}
                      className="w-4 h-4 rounded border-slate-300 flex-shrink-0"
                      title={blocking ? t.bulkBlockedHint : ''}
                    />
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <ClipboardList className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{r.machineId}</span>
                        <span className="text-xs text-slate-500">· {r.line}</span>
                        <StatusBadge status={r.status} t={t} report={r} user={user} />
                        {!abnormal && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-300">
                            <CheckCircle className="w-3 h-3" /> {t.filterNormal}
                          </span>
                        )}
                        {flags.map((f, i) => <AbnormalityBadge key={i} flag={f} t={t} />)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {fmtDate(r.date)} · {t.planQty}: {s.totalPlan} · OK: {s.totalOK} · NG: {s.totalNGAll} · {s.achievement}%
                      </div>
                      {blocking && (
                        <div className="text-[11px] text-rose-600 mt-0.5">{t.bulkBlockedHint}</div>
                      )}
                    </div>
                    <button onClick={() => onOpenReport(r)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 flex-shrink-0">{t.view}</button>
                  </div>
                );
              })}
              {filteredChiefItems.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">
                  {filter === 'normal' ? t.noNormalReports : filter === 'abnormal' ? t.noAbnormalReports : t.noPendingReports}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {canApprove && (
        <>
          {/* History */}
          {history.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h3 className="font-semibold text-slate-800">{t.approvalHistory}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.recentApproved}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {history.map(r => {
                  const when = isLeader
                    ? (r.shifts || []).reduce((max, s) => (s.approvedByLeaderAt && s.approvedByLeaderAt > max ? s.approvedByLeaderAt : max), '')
                    : (r.approvedByChiefAt || '');
                  const whenStr = when ? new Date(when).toLocaleString(lang === 'vi' ? 'vi-VN' : 'ja-JP', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
                  return (
                    <div key={r.id} className="p-3 text-sm">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-800">{r.machineId}</span>
                            <span className="text-xs text-slate-500">{fmtDate(r.date)}</span>
                            {whenStr && <span className="text-[11px] text-slate-400">· {whenStr}</span>}
                          </div>
                          {/* Operator names from shifts */}
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {(r.shifts || []).map(s => s.operatorName).filter(Boolean).join(', ')}
                          </div>
                          {/* Summary stats */}
                          {(() => {
                            const sm = calcReportSummary(r);
                            const totalOtMin = (r.shifts || []).reduce((sum, s) => sum + (s.overtimeEntries || []).reduce((a, ot) => a + (ot.minutes || 0), 0), 0);
                            return (
                              <div className="flex flex-wrap gap-3 mt-1 text-[11px]">
                                <span className="text-emerald-600">OK: {sm.totalOK}</span>
                                <span className="text-rose-500">NG: {sm.totalNGAll}</span>
                                <span className="text-amber-600">{t.totalDowntime}: {sm.totalDowntime}{t.min}</span>
                                {totalOtMin > 0 && <span className="text-purple-600">OT: {totalOtMin}{t.min}</span>}
                                <span className="text-blue-600">{sm.achievement}%</span>
                              </div>
                            );
                          })()}
                        </div>
                        <StatusBadge status={r.status} t={t} report={r} user={user} />
                        <button onClick={() => onOpenReport(r)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Eye className="w-4 h-4" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Bulk approve confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <ClipboardCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="font-bold text-lg text-slate-800">{t.approveConfirmTitle}</h3>
            </div>
            <p className="text-sm text-slate-600 mb-5">
              {t.approveConfirmMsg} ({selectedIds.size} {t.selectedCount})
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                {t.cancel}
              </button>
              <button onClick={handleBulkApprove} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
                {t.confirmApprove}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// UI: ANALYTICS PAGE (simplified)
// ============================================================================
const AnalyticsPage = ({ reports, t, lang }) => {
  // By machine
  const byMachine = useMemo(() => {
    return machines.map(m => {
      const machineReports = reports.filter(r => r.machineId === m.id && r.status === 'chief_approved');
      let plan = 0, ok = 0, ng = 0, dt = 0;
      machineReports.forEach(r => {
        const s = calcReportSummary(r);
        plan += s.totalPlan; ok += s.totalOK; ng += s.totalNGAll; dt += s.totalDowntime;
      });
      return { name: m.id, plan, actual: ok, ng, downtime: dt, ach: plan > 0 ? Math.round((ok / plan) * 100) : 0 };
    });
  }, [reports]);

  // NG by reason — aggregate from defectEntries (new model) with fallback to ngReasonId (legacy)
  const ngByReason = useMemo(() => {
    const map = {};
    reports.forEach(r => {
      r.shifts?.forEach(sh => {
        sh.productEntries?.forEach(pe => {
          if (pe.defectEntries?.length > 0) {
            pe.defectEntries.forEach(de => {
              if (de.defectType) {
                map[de.defectType] = (map[de.defectType] || 0) + (de.quantity || 1);
              }
            });
          } else if (pe.ngReasonId) {
            const total = (pe.ng || 0) + (pe.ngTest || 0) + (pe.ngPending || 0);
            map[pe.ngReasonId] = (map[pe.ngReasonId] || 0) + total;
          }
        });
      });
    });
    return Object.entries(map).map(([id, count]) => ({
      name: `${id} · ${getNGReasonName(id, lang)}`, value: count
    })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [reports, lang]);

  const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      <h2 className="text-xl font-bold text-slate-800">{t.analytics}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">{t.achievementRateByMachine}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byMachine}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} angle={-20} textAnchor="end" height={60} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="plan" fill="#94a3b8" name={t.planQty} />
              <Bar dataKey="actual" fill="#10b981" name={t.actualQty} />
              <Bar dataKey="ng" fill="#ef4444" name="NG" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">{t.ngCategory}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={ngByReason} cx="50%" cy="50%" labelLine={false} outerRadius={90} dataKey="value">
                {ngByReason.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-3">{t.achievementByMachine} (%)</h3>
        <div className="space-y-2">
          {byMachine.map(m => (
            <div key={m.name} className="flex items-center gap-3">
              <div className="w-24 text-sm text-slate-700 font-medium">{m.name}</div>
              <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden relative">
                <div className={`h-full ${m.ach >= 95 ? 'bg-emerald-500' : m.ach >= 80 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, m.ach)}%` }}></div>
                <div className="absolute inset-0 flex items-center px-2 text-xs font-semibold">
                  {m.ach}% · {m.actual} / {m.plan}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// UI: IFS INTEGRATION MOCK PAGE
// ============================================================================
const IFSIntegrationPage = ({ reports, setReports, t, lang }) => {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(new Date().toISOString());
  const [log, setLog] = useState([
    { time: new Date(Date.now() - 3600000).toISOString(), type: 'PULL', msg: 'Loaded 8 products from IFS (Key IFS)', status: 'OK' },
    { time: new Date(Date.now() - 1800000).toISOString(), type: 'PUSH', msg: 'Synced 12 production reports to IFS', status: 'OK' },
    { time: new Date(Date.now() - 600000).toISOString(), type: 'PULL', msg: 'Loaded monthly plan from IFS CSCO', status: 'OK' },
  ]);

  const handleSync = (type) => {
    setSyncing(true);
    setTimeout(() => {
      const newLog = {
        time: new Date().toISOString(),
        type,
        msg: type === 'PULL' ? 'Refreshed master data from IFS (simulated)' : `Pushed ${reports.filter(r => r.status === 'chief_approved' && !r.ifsSynced).length} reports to IFS (simulated)`,
        status: 'OK',
      };
      setLog([newLog, ...log]);
      setLastSync(new Date().toISOString());
      if (type === 'PUSH') {
        setReports(prev => prev.map(r => r.status === 'chief_approved' ? { ...r, ifsSynced: true, ifsSyncedAt: new Date().toISOString() } : r));
      }
      setSyncing(false);
    }, 1200);
  };

  const stats = {
    totalProducts: products.length,
    totalMachines: machines.length,
    completedReports: reports.filter(r => r.status === 'chief_approved').length,
    synced: reports.filter(r => r.ifsSynced).length,
  };

  return (
    <div className="p-6 space-y-4 bg-slate-50 min-h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">{t.ifsIntegration}</h2>
          <p className="text-sm text-slate-500">Mock IFS Applications ERP - Demo only</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            {t.ifsConnected}
          </div>
          <button onClick={() => handleSync('PULL')} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs hover:bg-slate-100 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> {t.ifsPullData}
          </button>
          <button onClick={() => handleSync('PUSH')} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50">
            <Upload className="w-3.5 h-3.5" /> {t.ifsPushData}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-xs text-slate-500">Products (from IFS)</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{stats.totalProducts}</div>
          <Package className="w-4 h-4 text-blue-400" />
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-xs text-slate-500">Machines</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{stats.totalMachines}</div>
          <Cog className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-xs text-slate-500">Completed Reports</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.completedReports}</div>
          <FileCheck className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <div className="text-xs text-slate-500">Synced to IFS</div>
          <div className="text-2xl font-bold text-purple-600 mt-1">{stats.synced} / {stats.completedReports}</div>
          <Database className="w-4 h-4 text-purple-400" />
        </div>
      </div>

      {/* Master data */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-3">{t.ifsMasterData}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">{t.productCode}</th>
                <th className="px-3 py-2 text-left">{t.productName}</th>
                <th className="px-3 py-2 text-left">{t.keyIFS}</th>
                <th className="px-3 py-2 text-left">{t.docCode}</th>
                <th className="px-3 py-2 text-right">CT</th>
                <th className="px-3 py-2 text-left">Compatible Machines</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.code} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-800">{p.code}</td>
                  <td className="px-3 py-2 text-slate-700">{p[`name_${lang}`]}</td>
                  <td className="px-3 py-2 font-mono text-blue-600">{p.keyIFS}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{p.docCode}</td>
                  <td className="px-3 py-2 text-right">{p.ct}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{[...new Set(ROUTING.filter(r => r.productCode === p.code).map(r => r.machineId))].join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync log */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <h3 className="font-semibold text-slate-800 mb-3">{t.syncLog}</h3>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {log.map((l, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 text-sm">
              <div className={`w-2 h-2 rounded-full ${l.status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${l.type === 'PULL' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-700'}`}>{l.type}</span>
              <span className="flex-1 text-slate-700">{l.msg}</span>
              <span className="text-xs text-slate-500">{new Date(l.time).toLocaleString(lang === 'vi' ? 'vi-VN' : 'ja-JP')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-800 border border-amber-200">
        <Info className="w-4 h-4 inline mr-1" />
        {lang === 'vi'
          ? 'Đây là demo mô phỏng kết nối với IFS Applications. Trong production sẽ dùng REST API / RFC để sync 2 chiều Master Data (Product, Route, BOM) và đẩy kết quả sản xuất (Shop Order Operation Report, Lot Traceability) lên IFS.'
          : 'IFS Applicationsとの接続を模擬したデモです。本番環境ではREST API / RFCを使用してマスターデータ (Product, Route, BOM) の双方向同期と生産実績 (Shop Order Operation Report, Lot Traceability) のIFSへの送信を行います。'}
      </div>
    </div>
  );
};

// ============================================================================
// UI: SETTINGS PAGE
// ============================================================================
const SettingsPage = ({ user, t, lang, setLang, otEnabledGlobal, setOtEnabledGlobal }) => {
  // Only Ast/Chief (section_manager) can change the OT setting
  const canEditOt = user.role === 'section_manager';
  return (
  <div className="p-6 space-y-4 bg-slate-50 min-h-full">
    <h2 className="text-xl font-bold text-slate-800">{t.settings}</h2>
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 space-y-4">
      <div>
        <label className="text-sm font-medium text-slate-700">{t.language}</label>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setLang('vi')} className={`px-4 py-2 rounded-lg text-sm ${lang === 'vi' ? 'bg-blue-600 text-white' : 'border border-slate-300'}`}>Tiếng Việt</button>
          <button onClick={() => setLang('ja')} className={`px-4 py-2 rounded-lg text-sm ${lang === 'ja' ? 'bg-blue-600 text-white' : 'border border-slate-300'}`}>日本語</button>
        </div>
      </div>

      {/* ============ GLOBAL OVERTIME TOGGLE (Ast/Chief only) ============ */}
      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-600" />
              <label className="text-sm font-semibold text-slate-800">{t.otSettingTitle}</label>
              {!canEditOt && (
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold border border-slate-300">
                  READ-ONLY
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">{t.otSettingDesc}</p>
            {!canEditOt && (
              <p className="text-[11px] text-amber-700 mt-1 italic">🔒 {t.otSettingOnlyManager}</p>
            )}
          </div>
          <button
            type="button"
            disabled={!canEditOt}
            onClick={() => canEditOt && setOtEnabledGlobal(!otEnabledGlobal)}
            className={`relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-full transition-colors ${
              otEnabledGlobal ? 'bg-purple-600' : 'bg-slate-300'
            } ${canEditOt ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-60'}`}
            aria-label="Toggle OT"
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
              otEnabledGlobal ? 'translate-x-8' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700">User Info</label>
        <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm">
          <div><strong>Name:</strong> {user.name}</div>
          <div><strong>Role:</strong> {user.roleLabel}</div>
          <div><strong>Dept:</strong> {user.dept}</div>
          {user.machineId && <div><strong>Machine:</strong> {user.machineId}</div>}
          {user.line && <div><strong>Line:</strong> {user.line}</div>}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700">Master Data Counts</label>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">Machines</div><div className="font-bold">{machines.length}</div></div>
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">Products</div><div className="font-bold">{products.length}</div></div>
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">Downtime Reasons</div><div className="font-bold">{downtimeReasons.length}</div></div>
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">NG Reasons</div><div className="font-bold">{ngReasons.length}</div></div>
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">Root Causes (4M)</div><div className="font-bold">{rootCauses.length}</div></div>
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">Countermeasures</div><div className="font-bold">{countermeasures.length}</div></div>
          <div className="p-2 rounded bg-blue-50 border border-blue-200"><div className="text-xs text-slate-500">Users</div><div className="font-bold">{mockUsers.length}</div></div>
        </div>
      </div>
      {/* ============ MIDDLEWARE TEST PANEL (moved from main layout) ============ */}
      <div className="border-t border-slate-200 pt-4 mt-4">
        <label className="text-sm font-medium text-slate-700 mb-2 block">Middleware Test Panel</label>
        <MiddlewarePanel />
      </div>
    </div>
  </div>
  );
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [lang, setLang] = useState('vi');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [editingReport, setEditingReport] = useState(null);
  // Remember which page opened the detail view so we can bounce back there
  // after approve/reject (e.g. Chief approves from Approvals → return to Approvals).
  const [reportOrigin, setReportOrigin] = useState('reports');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Global OT toggle (org-level, managed by Ast/Chief in Settings).
  // Plan-level OT override always takes priority over this.
  const [otEnabledGlobal, setOtEnabledGlobal] = useState(true);
  // ★ Login screen tab persistence — giữ nguyên vị trí tab sau logout
  const [loginTab, setLoginTab] = useState('Gia công CNC');
  const [loginShift, setLoginShift] = useState(1);

  // Wrap setReports to auto-persist to localStorage
  const setReportsAndPersist = (updater) => {
    setReports(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      savePersistReports(next);
      return next;
    });
  };

  useEffect(() => {
    // ★ Load saved reports from localStorage first
    const savedReports = loadSavedReports();
    const mockHistory = generateMockReports();
    const today = todayStr();

    if (__overrideReports && __overrideReports.length > 0) {
      console.log(`[App] Loaded ${__overrideReports.length} reports từ middleware`);
      // ★ Đánh dấu report từ middleware WO — dashboard dùng để phân biệt với report do user tạo
      const woReports = __overrideReports.map(r => ({ ...r, _fromWO: true }));
      const historyOnly = mockHistory.filter(r => r.date !== today);
      const merged = [...woReports, ...historyOnly]
        .sort((a, b) => b.date.localeCompare(a.date) || a.machineId.localeCompare(b.machineId));
      setReportsAndPersist(merged);
    } else if (savedReports.length > 0) {
      // Merge: saved reports override mock reports with same id
      console.log(`[App] Loaded ${savedReports.length} saved reports from localStorage`);
      const savedIds = new Set(savedReports.map(r => r.id));
      const freshMock = mockHistory.filter(r => !savedIds.has(r.id));
      const merged = [...savedReports, ...freshMock]
        .sort((a, b) => b.date.localeCompare(a.date) || a.machineId.localeCompare(b.machineId));
      setReports(merged); // don't re-persist, already in localStorage
    } else {
      console.log('[App] Dùng generateMockReports() (middleware không có reports)');
      setReportsAndPersist(mockHistory);
    }
  }, []);

  const t = translations[lang];

  const handleLogin = (user) => {
    setCurrentUser(user);
    setCurrentPage('dashboard');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentPage('dashboard');
    setSelectedReport(null);
    setEditingReport(null);
    setReportOrigin('reports');
    // ★ Giữ nguyên reports trong state + localStorage — không xóa, để user khác
    //   (leader/chief) có thể thấy report vừa submit.
    // (Không gọi setReports — giữ nguyên data hiện tại)
  };

  const handleOpenReport = (r) => {
    // Capture the current page BEFORE navigating so we know where to return.
    // Default to 'reports' for back-compat (e.g. direct dashboard link).
    setReportOrigin(currentPage === 'reportDetail' ? reportOrigin : (currentPage || 'reports'));
    setSelectedReport(r);
    setEditingReport(null);
    setCurrentPage('reportDetail');
  };

  const handleNewReport = () => {
    setEditingReport(null);
    setSelectedReport(null);
    setCurrentPage('reportForm');
  };

  const handleEditReport = (r) => {
    setEditingReport(r);
    setSelectedReport(null);
    setCurrentPage('reportForm');
  };

  const handleBack = () => {
    setSelectedReport(null);
    setEditingReport(null);
    // Return to the page that opened the detail view (e.g. Approvals),
    // falling back to the reports list.
    setCurrentPage(reportOrigin || 'reports');
  };

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} lang={lang} setLang={setLang} t={t} activeTab={loginTab} setActiveTab={setLoginTab} activeShift={loginShift} setActiveShift={setLoginShift} />;
  }

  // Determine page title
  const pageTitle = {
    dashboard: t.dashboard,
    reports: t.reports,
    reportForm: editingReport ? `${t.edit} - ${t.bm02Title}` : t.newReport,
    reportDetail: t.view,
    monthlyPlan: t.monthlyPlan,
    approvals: t.approvals,
    analytics: t.analytics,
    ifs: t.ifsIntegration,
    settings: t.settings,
  }[currentPage] || t.appTitle;

  return (
    <div className="flex h-screen bg-slate-100 font-sans">
      <Sidebar
        user={currentUser}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        onLogout={handleLogout}
        t={t}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {/* TopBar lives inside the scrollable main so it scrolls away and
              PageShell (sticky top-0) pins to the top of the viewport. */}
          <TopBar user={currentUser} lang={lang} setLang={setLang} t={t} />

          {currentPage === 'dashboard' && (
            <PageShell title={pageTitle} icon={Home} subtitle={currentUser.roleLabel}>
              <Dashboard user={currentUser} reports={reports} t={t} lang={lang} onOpenReport={handleOpenReport} onNewReport={handleNewReport} setCurrentPage={setCurrentPage} />
            </PageShell>
          )}
          {currentPage === 'reports' && (
            <PageShell title={pageTitle} icon={FileText}>
              <ReportsList reports={reports} user={currentUser} t={t} lang={lang} onOpenReport={handleOpenReport} onNewReport={handleNewReport} />
            </PageShell>
          )}
          {/* ReportForm has its own sticky header (with tabs + save/submit) so it renders standalone */}
          {currentPage === 'reportForm' && (
            <ReportForm user={currentUser} reports={reports} setReports={setReportsAndPersist} t={t} lang={lang} onBack={handleBack} existingReport={editingReport} otEnabledGlobal={otEnabledGlobal} />
          )}
          {currentPage === 'reportDetail' && selectedReport && (
            <PageShell title={pageTitle} icon={Eye}>
              <ReportDetail report={reports.find(r => r.id === selectedReport.id) || selectedReport} user={currentUser} reports={reports} setReports={setReportsAndPersist} t={t} lang={lang} onBack={handleBack} onEdit={handleEditReport} />
            </PageShell>
          )}
          {currentPage === 'monthlyPlan' && (
            <PageShell title={pageTitle} icon={Calendar}>
              <MonthlyPlanPage t={t} lang={lang} />
            </PageShell>
          )}
          {currentPage === 'approvals' && (
            <PageShell title={pageTitle} icon={UserCheck}>
              <ApprovalsPage user={currentUser} reports={reports} setReports={setReportsAndPersist} t={t} lang={lang} onOpenReport={handleOpenReport} />
            </PageShell>
          )}
          {currentPage === 'analytics' && (
            <PageShell title={pageTitle} icon={BarChart3}>
              <AnalyticsPage reports={reports} t={t} lang={lang} />
            </PageShell>
          )}
          {currentPage === 'ifs' && (
            <PageShell title={pageTitle} icon={Database}>
              <IFSIntegrationPage reports={reports} setReports={setReportsAndPersist} t={t} lang={lang} />
            </PageShell>
          )}
          {currentPage === 'settings' && (
            <PageShell title={pageTitle} icon={Settings}>
              <SettingsPage user={currentUser} t={t} lang={lang} setLang={setLang} otEnabledGlobal={otEnabledGlobal} setOtEnabledGlobal={setOtEnabledGlobal} />
            </PageShell>
          )}
        </main>
      </div>
    </div>
  );
}
