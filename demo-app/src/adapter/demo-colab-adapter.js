/**
 * FCC Frontend - Adapter cho demo-colab-new
 *
 * Dịch dữ liệu giữa middleware (v6 data: SP-A/B/C, máy CNC) và demo-colab-new
 * (P001-P008, máy Press/CNC/Mill).
 */

// ══════════════════════════════════════════════════════════════
//  Mapping tables
// ══════════════════════════════════════════════════════════════

// App codes now match v6/middleware codes directly (SP-A/B/C, CNC_MC_001, etc.)
// Identity mapping — no translation needed
export const PRODUCT_CODE_MAP = {
  toV6: {
    'SP-A': 'SP-A', 'SP-B': 'SP-B', 'SP-C': 'SP-C',
  },
  toApp: {
    'SP-A': 'SP-A', 'SP-B': 'SP-B', 'SP-C': 'SP-C',
  },
};

export const MACHINE_CODE_MAP = {
  toV6: {
    'TIEN01': 'TIEN01', 'PHAY01': 'PHAY01',
    'PHAY02': 'PHAY02', 'OTHER': 'OTHER',
  },
  toApp: {
    'TIEN01': 'TIEN01', 'PHAY01': 'PHAY01',
    'PHAY02': 'PHAY02', 'OTHER': 'OTHER',
  },
};

export const DOWNTIME_CODE_MAP = {
  'DT_MEETING':'DT10', 'DT_CHECK':'DT09', 'DT_MATERIAL':'DT03', 'DT_TOOL_CHANGE':'DT06',
  'DT_ADJUST':'DT01', 'DT_REPAIR':'DT02', 'DT_POWER':'DT08', 'DT_QC':'DT04',
  'DT_TRAINING':'DT13', 'DT_CLEANING':'DT11', 'DT_REPORT':'DT14', 'DT_SAFETY':'DT14',
  'DT_PROGRAM':'DT07', 'DT_MAINT':'DT05', 'DT_BREAK':'DT12',
};

// ══════════════════════════════════════════════════════════════
//  Adapt PRODUCTS
//  ⚠ Field names PHẢI khớp App.jsx schema: { code, name_vi, name_ja, keyIFS, docCode, ct, dailyTarget }
// ══════════════════════════════════════════════════════════════
export function adaptProductsForApp(middlewareProducts, boms = []) {
  // Build map: productId → [appMachineIds] từ BOM operations
  const machineMap = {};
  for (const bom of boms || []) {
    if (!bom?.productId) continue;
    const codes = new Set();
    (bom.operations || []).forEach(op => {
      const wcName = op.workcenterName || '';
      const v6Code = wcName.includes('TIỆN') ? 'TIEN01'
                   : wcName.includes('PHAY CNC 01') ? 'PHAY01'
                   : wcName.includes('PHAY CNC 02') ? 'PHAY02'
                   : 'OTHER';
      codes.add(MACHINE_CODE_MAP.toApp[v6Code] || v6Code);
    });
    machineMap[bom.productId] = Array.from(codes);
  }

  return (middlewareProducts || [])
    .filter(p => p && (p.isFinished !== false))
    .map(p => ({
      code: PRODUCT_CODE_MAP.toApp[p.code] || p.code,
      name_vi: p.name || '',
      name_ja: p.name || '',
      keyIFS: `IFS-CSCO-${String(p.id).padStart(3, '0')}`,
      docCode: `DC-F${String(p.id).padStart(3, '0')}`,
      ct: 3.0,
      machineCompat: machineMap[p.id] || [],
    }));
}

// ══════════════════════════════════════════════════════════════
//  Adapt MACHINES
//  ⚠ Schema: { id, name, line, dept, shift1Cap, shift2Cap, shift3Cap, rate }
//  line & dept khởi tạo sẵn theo workcenter code — user KHÔNG thay đổi được
// ══════════════════════════════════════════════════════════════
const MACHINE_LINE_DEPT = {
  TIEN01: { line: 'Line Tiện',     dept: 'Gia công CNC' },
  PHAY01: { line: 'Line Phay',     dept: 'Gia công CNC' },
  PHAY02: { line: 'Line Phay',     dept: 'Gia công CNC' },
  OTHER:  { line: 'Line Tổng hợp', dept: 'Gia công CNC' },
};

export function adaptMachinesForApp(middlewareWorkcenters) {
  return (middlewareWorkcenters || []).map(wc => {
    const code = wc.code || '';
    const ld = MACHINE_LINE_DEPT[code] || { line: 'Line Tổng hợp', dept: 'Gia công CNC' };
    return {
      id: MACHINE_CODE_MAP.toApp[code] || code,
      name: wc.name || code,
      line: ld.line,
      dept: ld.dept,
      shift1Cap: Math.floor((wc.capacity || 1) * 200),
      shift2Cap: Math.floor((wc.capacity || 1) * 200),
      shift3Cap: Math.floor((wc.capacity || 1) * 200),
      rate: wc.oeeTarget ? wc.oeeTarget / 100 : 0.75,
    };
  });
}

// ══════════════════════════════════════════════════════════════
//  Adapt WORK ORDERS → REPORTS
//
//  Logic gộp:
//    12 WOs từ middleware (1 WO = 1 operation × 1 product × 1 shift)
//    → group theo (machine, date)
//    → 1 report cho mỗi (máy, ngày)
//    → mỗi report có 3 shifts
//    → mỗi shift có productEntries từ các WO match shift đó
//
//  Pre-fill mỗi productEntry:
//    - planQty từ WO.x_qty_planned
//    - okCount khởi tạo = planQty
//    - lotNumber + operation name
//
//  Pre-fill mỗi shift:
//    - operatorId/Name từ WO của ca đó
//    - leaderId/Name từ WO leader
// ══════════════════════════════════════════════════════════════
export function adaptWorkOrdersForApp(middlewareWOs) {
  if (!Array.isArray(middlewareWOs) || middlewareWOs.length === 0) return [];

  // Group WOs by (machine, date)
  const grouped = {};
  for (const wo of middlewareWOs) {
    const machineCode = wo.workcenter?.code || _machineNameToCode(wo.workcenter?.name);
    const date = (wo.dateStart || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const key = `${machineCode}__${date}`;
    if (!grouped[key]) {
      grouped[key] = {
        machineCode,
        machineName: wo.workcenter?.name || '',
        date,
        wosByShift: { ca_1: [], ca_2: [], ca_3: [] },
      };
    }
    const shiftKey = wo.shift || 'ca_1';
    if (grouped[key].wosByShift[shiftKey]) {
      grouped[key].wosByShift[shiftKey].push(wo);
    }
  }

  return Object.values(grouped).map(g => {
    const appMachineId = MACHINE_CODE_MAP.toApp[g.machineCode] || g.machineCode;

    const shifts = [1, 2, 3].map(shiftNum => {
      const shiftKey = `ca_${shiftNum}`;
      const shiftWOs = g.wosByShift[shiftKey] || [];
      const firstWO = shiftWOs[0];

      const operatorId = firstWO?.operator?.id || '';
      const operatorName = firstWO?.operator?.name || '';
      const leaderId = firstWO?.leader?.id || '';
      const leaderName = firstWO?.leader?.name || '';

      const productEntries = shiftWOs.map(wo => {
        const planned = wo.quantities?.planned || 0;
        const actualOk = wo.quantities?.ok || 0;
        const v6Code = (wo.product?.name || '').match(/SP-[ABC]/)?.[0]
                    || (wo.product?.name || '').replace('Sản Phẩm ', 'SP-').slice(0, 4);
        // ★ Include operation name in productName for consistency with guideline
        const opName = wo.operation?.name || '';
        const baseName = wo.product?.name || '';
        const fullName = opName ? `${baseName} — ${opName}` : baseName;
        return {
          id: `pe-wo-${wo.id}`,
          productCode: PRODUCT_CODE_MAP.toApp[v6Code] || v6Code,
          productName_vi: fullName,
          productName_ja: fullName,
          keyIFS: `IFS-CSCO-${String(wo.product?.id || 0).padStart(3, '0')}`,
          docCode: `DC-F${String(wo.product?.id || 0).padStart(3, '0')}`,
          lotNumber: wo.lotNumber || `LOT-${g.date.replace(/-/g, '')}-${appMachineId}-S${shiftNum}`,
          operationName: opName,
          planQty: planned,
          okCount: actualOk || planned,  // ⭐ initial = planned
          ngTest: wo.quantities?.ngTest || 0,
          ngPending: wo.quantities?.ngPending || 0,
          defectEntries: [],
          ifsSynced: false,
          fromPlan: true,
          _woId: wo.id,
        };
      });

      return {
        shiftNumber: shiftNum,
        operatorId, operatorName,
        leaderId, leaderName,
        leaderFromPlan: !!leaderId,
        startTime: shiftNum === 1 ? '06:00' : shiftNum === 2 ? '14:00' : '22:00',
        endTime:   shiftNum === 1 ? '14:00' : shiftNum === 2 ? '22:00' : '06:00',
        status: _approvalStateToShiftStatus(firstWO?.approval?.state),
        submittedAt: firstWO?.approval?.date || null,
        productEntries,
        downtimeEntries: [],
        overtimeEntries: [],
      };
    });

    const allWOs = [...g.wosByShift.ca_1, ...g.wosByShift.ca_2, ...g.wosByShift.ca_3];
    const states = allWOs.map(wo => wo.approval?.state || 'draft');
    const reportStatus = _aggregateReportStatus(states);

    const ld = MACHINE_LINE_DEPT[g.machineCode] || { line: 'Line Tổng hợp', dept: 'Gia công CNC' };
    return {
      id: `RPT-${g.date.replace(/-/g, '')}-${appMachineId}`,
      date: g.date,
      machineId: appMachineId,
      machineName: g.machineName,
      line: ld.line,
      dept: ld.dept,
      shifts,
      status: reportStatus,
      createdAt: g.date + 'T06:00:00',
      ifsSynced: states.every(s => s === 'chief_approved'),
    };
  });
}

// ── Helpers ──
function _machineNameToCode(name) {
  if (!name) return '';
  if (name.includes('TIỆN')) return 'TIEN01';
  if (name.includes('PHAY CNC 01')) return 'PHAY01';
  if (name.includes('PHAY CNC 02')) return 'PHAY02';
  return 'OTHER';
}

function _aggregateReportStatus(states) {
  if (states.every(s => s === 'chief_approved')) return 'chief_approved';
  if (states.some(s => s === 'rejected')) return 'rejected';
  if (states.every(s => s === 'leader_approved' || s === 'chief_approved')) return 'leader_approved';
  if (states.some(s => s === 'submitted' || s === 'leader_approved')) return 'submitted';
  return 'draft';
}

function _approvalStateToShiftStatus(state) {
  const map = {
    draft: 'draft',
    submitted: 'submitted',
    leader_approved: 'leader_approved',
    chief_approved: 'leader_approved',
    rejected: 'rejected',
  };
  return map[state] || 'draft';
}

// ══════════════════════════════════════════════════════════════
//  Adapt: App report → Middleware submit format
//
//  ★ Mỗi productEntry trong 1 shift = 1 WO call riêng trên Odoo
//    (vì Odoo quản lý 1 WO = 1 machine × 1 product × 1 operation)
//
//  adaptReportForMiddleware: 1 productEntry → 1 payload
//  adaptShiftForMiddleware:  1 shift → array payloads (1 per productEntry)
// ══════════════════════════════════════════════════════════════
export function adaptReportForMiddleware(appReport, shiftIndex = 0, productEntry = null, options = {}) {
  const shift = appReport.shifts[shiftIndex];
  const entry = productEntry || shift?.productEntries?.[0];
  if (!entry) throw new Error('No product entry in report');

  const v6Code = PRODUCT_CODE_MAP.toV6[entry.productCode] || entry.productCode;
  const v6MachineCode = MACHINE_CODE_MAP.toV6[appReport.machineId] || appReport.machineId;

  return {
    // ★ workorder_id: nếu có _woId từ WO đã load → update thay vì create
    workorder_id: entry._woId || null,
    workcenter_code: v6MachineCode,
    product_code: v6Code,
    shift: `ca_${shift.shiftNumber}`,
    date: appReport.date,
    lot_number: entry.lotNumber || '',
    operator: { id: shift.operatorId, name: shift.operatorName },
    leader:   { id: shift.leaderId,   name: shift.leaderName },
    // ★ save_as_draft: lưu nháp hay submit chờ duyệt
    save_as_draft: options.saveAsDraft ?? false,
    quantities: {
      ok: entry.okCount || 0,
      ng: (entry.defectEntries || []).reduce((s, d) => s + (d.qty || d.quantity || 0), 0),
      ng_test: entry.ngTest || 0,
      ng_pending: entry.ngPending || 0,
    },
    ng_details: (entry.defectEntries || []).map(d => ({
      reason_code: d.defectCode,
      root_cause_code: d.rootCauseCode || null,
      root_cause_category: d.rootCauseCategory || null,
      countermeasure_code: d.countermeasureCode || null,
      qty: d.qty || d.quantity || 0,
      note: d.note || '',
    })),
    downtime_entries: (shift.downtimeEntries || []).map(dt => ({
      reason_code: DOWNTIME_CODE_MAP[dt.reasonCode] || dt.reasonCode || `DT${String(dt.reasonId || 14).padStart(2, '0')}`,
      planned_minutes: dt.plannedMinutes || 0,
      actual_minutes: dt.actualMinutes || dt.duration || dt.minutes || 0,
      is_planned: dt.isPlanned ?? false,
      start_time: dt.startTime || '',
      end_time: dt.endTime || '',
      note: dt.note || '',
    })),
    // ★ Overtime mapping — chỉ gửi fields có trong Odoo overtime.entry model
    overtime_entries: (shift.overtimeEntries || []).map(ot => ({
      reason_code: ot.reasonId || 'OT99',
      minutes: ot.minutes || 0,
      operator_ids: shift.operatorId || '',
      note: ot.note || '',
    })),
  };
}

/**
 * ★ Adapt 1 shift → array of middleware payloads (1 per productEntry)
 *   Dùng trong handleSave để gửi tất cả products trong 1 ca lên Odoo
 */
export function adaptShiftForMiddleware(appReport, shiftIndex, options = {}) {
  const shift = appReport.shifts[shiftIndex];
  if (!shift?.productEntries?.length) return [];

  return shift.productEntries
    .filter(pe => pe.productCode) // skip empty entries
    .map(pe => adaptReportForMiddleware(appReport, shiftIndex, pe, options));
}

export function resolveIdsFromCodes(masterData, middlewareReport) {
  const wc = masterData.workcenters?.find(w => w.code === middlewareReport.workcenter_code)
          || masterData.workcenters?.find(w => MACHINE_CODE_MAP.toApp[w.code] === middlewareReport.workcenter_code);
  const product = masterData.finishedProducts?.find(p => p.code === middlewareReport.product_code);
  return {
    ...middlewareReport,
    workcenter_id: wc?.id,
    product_id: product?.id,
  };
}

export default {
  adaptProductsForApp, adaptMachinesForApp, adaptWorkOrdersForApp,
  adaptReportForMiddleware, adaptShiftForMiddleware, resolveIdsFromCodes,
  PRODUCT_CODE_MAP, MACHINE_CODE_MAP, DOWNTIME_CODE_MAP,
};
