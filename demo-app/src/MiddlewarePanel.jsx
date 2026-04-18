/**
 * MiddlewarePanel — Floating test panel for demo-colab-new
 *
 * Adds a collapsible floating panel (bottom-right corner) that lets you:
 * - Login as operator/leader/manager
 * - Check middleware connection health
 * - Load master data from middleware (SP A/B/C, máy CNC, BoMs)
 * - Submit test production report
 * - View work orders list + approve/reject/withdraw
 *
 * Usage in App.jsx:
 *   import MiddlewarePanel from './MiddlewarePanel';
 *   // ... somewhere in your JSX:
 *   <MiddlewarePanel />
 */
import { useState, useEffect, useCallback } from 'react';
import config from './config';
import authApi from './api/auth.api';
import masterDataApi from './api/master-data.api';
import workOrderApi from './api/work-order.api';
import { approvalApi, reportApi } from './api/report.api';

const ROLES = [
  { id: 'OP001', pin: '1234', label: 'OP001 - Operator (Nguyễn Văn An)' },
  { id: 'OP002', pin: '1234', label: 'OP002 - Operator (Trần Thị Bình)' },
  { id: 'LD001', pin: '5678', label: 'LD001 - Leader (Phạm Minh Đức)' },
  { id: 'MGR01', pin: '9999', label: 'MGR01 - Manager (Phạm Thị Hoa)' },
];

const STATE_COLORS = {
  draft: '#e5e7eb',
  submitted: '#fef3c7',
  leader_approved: '#dbeafe',
  chief_approved: '#d1fae5',
  rejected: '#fee2e2',
};

export default function MiddlewarePanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('connection');
  const [user, setUser] = useState(authApi.getCurrentUser());
  const [health, setHealth] = useState(null);
  const [masterData, setMasterData] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedWO, setSelectedWO] = useState(null);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const log = useCallback((msg, obj) => {
    const stamp = new Date().toLocaleTimeString();
    setOutput(prev =>
      `[${stamp}] ${msg}${obj ? '\n' + JSON.stringify(obj, null, 2) : ''}\n\n` + prev
    );
  }, []);

  // Health check on mount
  useEffect(() => {
    checkHealth();
  }, []);

  async function checkHealth() {
    try {
      const res = await fetch(config.apiUrl.replace('/api/v1', '/health'));
      const data = await res.json();
      setHealth(data);
      log('✓ Middleware connected', data);
    } catch (e) {
      setHealth({ error: e.message });
      log('✗ Middleware connection failed', { error: e.message });
    }
  }

  async function doLogin(id, pin) {
    setLoading(true);
    try {
      const res = await authApi.login(id, pin);
      setUser(res.user);
      log(`✓ Logged in as ${res.user.name}`, res.user);
    } catch (e) {
      log('✗ Login failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function doLogout() {
    authApi.logout();
    setUser(null);
    log('→ Logged out');
  }

  async function loadMaster() {
    setLoading(true);
    try {
      const data = await masterDataApi.getAll();
      setMasterData(data);
      log('✓ Master data loaded', {
        finishedProducts: data.finishedProducts?.length,
        materials: data.materials?.length,
        workcenters: data.workcenters?.length,
        boms: data.boms?.length,
      });
    } catch (e) {
      log('✗ ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWOs() {
    setLoading(true);
    try {
      const data = await workOrderApi.list({ limit: 20 });
      setWorkOrders(data);
      log(`✓ Loaded ${data.length} work orders`);
    } catch (e) {
      log('✗ ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWODetail(id) {
    setLoading(true);
    try {
      const data = await workOrderApi.getDetail(id);
      setSelectedWO(data);
      log(`✓ WO #${id} detail`, data);
    } catch (e) {
      log('✗ ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitSample() {
    setLoading(true);
    try {
      const report = {
        workcenter_id: 1,
        product_id: 1,
        shift: 'ca_1',
        date: new Date().toISOString().slice(0, 10),
        lot_number: `TEST-${Date.now()}`,
        operator: user ? { id: user.id, name: user.name } : { id: 'OP001', name: 'Test' },
        leader: { id: 'LD001', name: 'Phạm Minh Đức' },
        quantities: { ok: 950, ng: 30, ng_test: 10, ng_pending: 0 },
        ng_details: [
          { reason_code: 'D01', root_cause_code: 'M03', root_cause_category: 'machine', countermeasure_code: 'A02', qty: 18, note: 'Dao mòn' },
          { reason_code: 'D02', root_cause_code: 'M05', root_cause_category: 'machine', countermeasure_code: 'A04', qty: 12, note: '' },
        ],
        downtime_entries: [
          { reason_code: 'DT01', planned_minutes: 30, actual_minutes: 32, is_planned: true, note: 'Chuyển SP' },
          { reason_code: 'DT02', planned_minutes: 0, actual_minutes: 45, is_planned: false, note: 'Sửa máy' },
        ],
      };
      const result = await workOrderApi.submitReport(report);
      log('✓ Report submitted! state=' + result.approval.state, result);
      loadWOs();
    } catch (e) {
      log('✗ ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function approvalAction(woId, action) {
    setLoading(true);
    try {
      let r;
      if (action === 'submit') r = await approvalApi.submit(woId);
      else if (action === 'withdraw') r = await approvalApi.withdraw(woId);
      else if (action === 'leader-approve') r = await approvalApi.leaderApprove(woId, 'OK');
      else if (action === 'chief-approve') r = await approvalApi.chiefApprove(woId, 'OK');
      else if (action === 'reset') r = await approvalApi.resetToDraft(woId);
      log(`✓ ${action} → state=${r.currentState}`);
      loadWOs();
      if (selectedWO?.id === woId) loadWODetail(woId);
    } catch (e) {
      log('✗ ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function doReject(woId) {
    const comment = prompt('Lý do reject:');
    if (!comment) return;
    setLoading(true);
    try {
      const r = await approvalApi.reject(woId, comment);
      log(`✓ reject → state=${r.currentState}`);
      loadWOs();
      if (selectedWO?.id === woId) loadWODetail(woId);
    } catch (e) {
      log('✗ ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  // Styles
  const panelStyle = {
    position: 'fixed', bottom: 16, right: 16, zIndex: 99999,
    width: open ? 520 : 48, height: open ? 640 : 48,
    background: 'white', boxShadow: '0 6px 24px rgba(0,0,0,0.2)',
    borderRadius: 8, display: 'flex', flexDirection: 'column',
    overflow: 'hidden', transition: 'all 0.2s',
    fontFamily: '-apple-system, system-ui, sans-serif', fontSize: 12,
  };
  const header = {
    padding: '8px 12px', background: '#1F4E79', color: 'white',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    cursor: 'pointer', flexShrink: 0,
  };
  const btn = {
    padding: '4px 10px', margin: '2px', fontSize: 11,
    border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer',
    background: 'white',
  };
  const btnPrimary = { ...btn, background: '#2E75B6', color: 'white', borderColor: '#2E75B6' };
  const btnDanger  = { ...btn, background: '#dc2626', color: 'white', borderColor: '#dc2626' };
  const btnSuccess = { ...btn, background: '#16a34a', color: 'white', borderColor: '#16a34a' };
  const tabBtn = (id) => ({
    ...btn, borderRadius: 0, borderBottom: tab === id ? '2px solid #1F4E79' : '2px solid transparent',
    fontWeight: tab === id ? 600 : 400,
  });

  if (!open) {
    return (
      <div style={panelStyle} onClick={() => setOpen(true)} title="Middleware Test Panel">
        <div style={{ ...header, padding: 0, justifyContent: 'center', height: '100%' }}>🧪</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={header} onClick={() => setOpen(false)}>
        <span>🧪 Middleware Test Panel {health?.mode ? `(${health.mode})` : ''}</span>
        <span style={{ cursor: 'pointer' }}>✕</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <button style={tabBtn('connection')} onClick={() => setTab('connection')}>Kết nối</button>
        <button style={tabBtn('master')} onClick={() => setTab('master')}>Master Data</button>
        <button style={tabBtn('wo')} onClick={() => setTab('wo')}>Work Orders</button>
        <button style={tabBtn('log')} onClick={() => setTab('log')}>Log</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>

        {/* ─── CONNECTION TAB ─── */}
        {tab === 'connection' && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <b>Middleware:</b>{' '}
              {health?.status === 'ok' ? (
                <span style={{ color: '#16a34a' }}>
                  ✓ Connected ({health.mode}){' '}
                  {health.mode === 'MOCK' && `— mock store: ${Object.values(health.odoo?.mockStore || {}).reduce((a, b) => a + b, 0)} records`}
                </span>
              ) : (
                <span style={{ color: '#dc2626' }}>✗ Not connected ({health?.error || '...'})</span>
              )}
              <button style={btn} onClick={checkHealth}>Refresh</button>
            </div>

            <div style={{ marginBottom: 8 }}>
              <b>API URL:</b> <code>{config.apiUrl}</code>
            </div>

            <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

            <div style={{ marginBottom: 6 }}><b>User hiện tại:</b></div>
            {user ? (
              <div style={{ marginBottom: 8, padding: 8, background: '#f0fdf4', borderRadius: 4 }}>
                ✓ <b>{user.name}</b> ({user.role}) — {user.id}
                <button style={{ ...btn, marginLeft: 8 }} onClick={doLogout}>Logout</button>
              </div>
            ) : (
              <div style={{ marginBottom: 8, padding: 8, background: '#fef3c7', borderRadius: 4 }}>Chưa đăng nhập</div>
            )}

            <div style={{ marginBottom: 6 }}><b>Đăng nhập nhanh:</b></div>
            {ROLES.map(r => (
              <button key={r.id} style={btn} onClick={() => doLogin(r.id, r.pin)} disabled={loading}>
                {r.label}
              </button>
            ))}
          </div>
        )}

        {/* ─── MASTER DATA TAB ─── */}
        {tab === 'master' && (
          <div>
            <button style={btnPrimary} onClick={loadMaster} disabled={loading || !user}>
              🔄 Load Master Data
            </button>
            {!user && <span style={{ color: '#dc2626', marginLeft: 8 }}>Cần login trước</span>}

            {masterData && (
              <div style={{ marginTop: 10 }}>
                <div style={{ marginBottom: 8 }}>
                  <b>Thành phẩm ({masterData.finishedProducts?.length}):</b>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {masterData.finishedProducts?.map(p => (
                      <li key={p.id}>
                        <b>{p.code}</b> — {p.name} <span style={{ color: '#6b7280' }}>({p.dailyTarget}/ngày)</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <b>Nguyên vật liệu ({masterData.materials?.length}):</b>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {masterData.materials?.map(p => (
                      <li key={p.id}><b>{p.code}</b> — {p.name} ({p.uom})</li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <b>Máy CNC ({masterData.workcenters?.length}):</b>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {masterData.workcenters?.map(wc => (
                      <li key={wc.id}><b>{wc.code}</b> — {wc.name}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <b>BoMs + Routing ({masterData.boms?.length}):</b>
                  {masterData.boms?.map(bom => (
                    <div key={bom.id} style={{ marginTop: 6, padding: 6, background: '#f9fafb', borderRadius: 4 }}>
                      <b>{bom.code}</b> — {bom.productName} ({bom.totalCycleTime}p total)
                      <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>
                        Operations: {bom.operations.map(o => `${o.sequence}. ${o.name}`).join(' → ')}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        Components: {bom.components.map(c => `${c.productName} (${c.quantity} ${c.uom})`).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── WORK ORDERS TAB ─── */}
        {tab === 'wo' && (
          <div>
            <button style={btnPrimary} onClick={loadWOs} disabled={loading || !user}>🔄 Load WOs</button>
            <button style={btn} onClick={submitSample} disabled={loading || !user}>📤 Submit sample report</button>
            {!user && <span style={{ color: '#dc2626', marginLeft: 8 }}>Cần login</span>}

            <div style={{ marginTop: 10 }}>
              {workOrders.map(wo => (
                <div key={wo.id}
                  style={{ padding: 6, margin: '4px 0', background: '#f9fafb', borderRadius: 4, cursor: 'pointer' }}
                  onClick={() => loadWODetail(wo.id)}>
                  <b>{wo.name}</b>{' '}
                  <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, background: STATE_COLORS[wo.approval.state] || '#e5e7eb' }}>
                    {wo.approval.state}
                  </span>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {wo.workcenter?.name} • {wo.product?.name} • {wo.shift} • OK={wo.quantities.ok} NG={wo.quantities.ng}
                  </div>
                </div>
              ))}
            </div>

            {selectedWO && (
              <div style={{ marginTop: 12, padding: 10, border: '2px solid #1F4E79', borderRadius: 4 }}>
                <b>#{selectedWO.id} — {selectedWO.name}</b>{' '}
                <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, background: STATE_COLORS[selectedWO.approval.state] }}>
                  {selectedWO.approval.state}
                </span>
                <div style={{ marginTop: 6 }}>
                  <b>Operator:</b> {selectedWO.operator.name} | <b>Leader:</b> {selectedWO.leader.name}<br />
                  <b>OK:</b> {selectedWO.quantities.ok} / <b>NG:</b> {selectedWO.quantities.ng}<br />
                  <b>NG Details:</b> {selectedWO.ngDetails?.length || 0} • <b>Downtime:</b> {selectedWO.downtimeEntries?.length || 0}
                </div>
                <div style={{ marginTop: 8 }}>
                  {selectedWO.approval.state === 'draft' && user?.role === 'operator' && (
                    <button style={btnPrimary} onClick={() => approvalAction(selectedWO.id, 'submit')}>📤 Submit</button>
                  )}
                  {selectedWO.approval.state === 'submitted' && user?.role === 'operator' && (
                    <button style={btn} onClick={() => approvalAction(selectedWO.id, 'withdraw')}>↩ Withdraw</button>
                  )}
                  {selectedWO.approval.state === 'submitted' && (user?.role === 'leader' || user?.role === 'manager') && (
                    <>
                      <button style={btnSuccess} onClick={() => approvalAction(selectedWO.id, 'leader-approve')}>✓ Leader Approve</button>
                      <button style={btnDanger} onClick={() => doReject(selectedWO.id)}>✗ Reject</button>
                    </>
                  )}
                  {selectedWO.approval.state === 'leader_approved' && user?.role === 'manager' && (
                    <>
                      <button style={btnSuccess} onClick={() => approvalAction(selectedWO.id, 'chief-approve')}>✓ Manager Approve (FINAL)</button>
                      <button style={btnDanger} onClick={() => doReject(selectedWO.id)}>✗ Reject</button>
                    </>
                  )}
                  {selectedWO.approval.state === 'rejected' && user?.role === 'operator' && (
                    <button style={btnPrimary} onClick={() => approvalAction(selectedWO.id, 'reset')}>🔄 Reset</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── LOG TAB ─── */}
        {tab === 'log' && (
          <pre style={{ fontSize: 10, background: '#1e293b', color: '#e2e8f0', padding: 8, borderRadius: 4, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {output || '(chưa có log)'}
          </pre>
        )}
      </div>

      {loading && (
        <div style={{ padding: 6, textAlign: 'center', fontSize: 11, background: '#fef3c7', color: '#92400e' }}>
          ⏳ Loading...
        </div>
      )}
    </div>
  );
}
