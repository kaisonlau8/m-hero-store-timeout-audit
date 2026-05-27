import config from '../config.js';
import { listRecords } from 'feishu-bitable-middleware/src/services/feishu.js';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

async function fetchAllRecords(tableId, viewId) {
  let allRecords = [];
  let pageToken = null;
  do {
    const result = await listRecords({ tableId, viewId, pageSize: 100, pageToken });
    allRecords = allRecords.concat(result.items || []);
    pageToken = result.page_token;
  } while (pageToken);
  return allRecords;
}

/**
 * 模糊匹配：去掉"猛士"前缀后比较核心名称
 */
function storeNameMatch(a, b) {
  if (a === b) return true;
  const strip = s => s.replace(/^猛士/, '');
  return strip(a) === strip(b);
}

export async function runAudit() {
  // ── 1. 读取 xlsx 作为主数据源 ──
  const xlsxStores = loadXlsxStores();

  // ── 2. 读取门店清单 bitable ──
  const bitableRecords = await fetchAllRecords(config.bitable.storeTableId, config.bitable.storeViewId);
  const bitableStores = bitableRecords.map(r => ({
    name: r.fields['门店名称'] || '',
    code: r.fields['门店编码'] || '',
    area: r.fields['区域'] || '',
    hasAfterSales: r.fields['是否有售后'] || '',
    supervisor: r.fields['服务督导'] || '',
  }));

  // ── 3. xlsx vs bitable 差异检查 ──
  const discrepancies = checkDiscrepancies(xlsxStores, bitableStores);

  // ── 4. 读取登记表，提取店名 ──
  const registrationRecords = await fetchAllRecords(config.bitable.registrationTableId, config.bitable.registrationViewId);
  const registeredNames = new Set();
  for (const r of registrationRecords) {
    const dealer = r.fields['经销商'];
    if (dealer && Array.isArray(dealer)) {
      for (const link of dealer) {
        const text = (link.text || '').trim();
        if (text) registeredNames.add(text);
      }
    }
  }

  // ── 5. 以 xlsx 门店名为准，匹配登记状态 ──
  const allStores = xlsxStores.map(s => ({
    ...s,
    registered: isStoreRegistered(s.name, registeredNames),
  }));

  const unregisteredStores = allStores.filter(s => !s.registered);
  const registeredStores = allStores.filter(s => s.registered);

  // ── 6. 按督导分组（督导信息来自 xlsx）──
  const bySupervisor = {};
  for (const s of allStores) {
    const sup = s.supervisor || '未知';
    if (!bySupervisor[sup]) {
      bySupervisor[sup] = { total: 0, registered: 0, unregistered: 0, stores: [] };
    }
    bySupervisor[sup].total++;
    if (s.registered) {
      bySupervisor[sup].registered++;
    } else {
      bySupervisor[sup].unregistered++;
    }
    bySupervisor[sup].stores.push(s);
  }

  // ── 7. 按区域分组 ──
  const byArea = {};
  for (const s of allStores) {
    const area = s.area || '未知';
    if (!byArea[area]) {
      byArea[area] = { total: 0, registered: 0, unregistered: 0 };
    }
    byArea[area].total++;
    if (s.registered) byArea[area].registered++;
    else byArea[area].unregistered++;
  }

  // ── 8. 生成 Excel ──
  const excelPath = await generateExcel(allStores, bySupervisor);

  // ── 9. 读取督导手机号（从 xlsx）──
  const supervisorPhones = {};
  for (const s of xlsxStores) {
    if (s.supervisor && s.phone) {
      supervisorPhones[s.supervisor] = s.phone;
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    totalStores: allStores.length,
    registeredCount: registeredStores.length,
    unregisteredCount: unregisteredStores.length,
    registrationRate: allStores.length > 0
      ? (registeredStores.length / allStores.length * 100).toFixed(1) + '%'
      : '0%',
    discrepancies,
    bySupervisor,
    byArea,
    unregisteredStores,
    allStores,
    excelPath,
    supervisorPhones,
  };

  // ── 10. 保存审计日志 ──
  saveAuditLog(result);

  return result;
}

function loadXlsxStores() {
  const wb = XLSX.readFile(config.storeListPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws);

  return data.map(row => {
    const phone = row['督导手机号'];
    const phoneStr = phone ? String(phone).replace(/^86/, '') : '';
    const formattedPhone = phoneStr.startsWith('+') ? phoneStr : (phoneStr ? `+86${phoneStr}` : '');

    return {
      name: row['门店名称'] || '',
      code: row['门店编码'] || '',
      area: row['区域'] || '',
      supervisor: row['督导'] || '',
      phone: formattedPhone,
    };
  });
}

/**
 * 判断门店是否已登记：先用精确匹配，再用去"猛士"前缀模糊匹配
 */
function isStoreRegistered(storeName, registeredNames) {
  if (registeredNames.has(storeName)) return true;
  for (const regName of registeredNames) {
    if (storeNameMatch(storeName, regName)) return true;
  }
  return false;
}

/**
 * 比对 xlsx 与 bitable 门店清单，找出差异
 */
function checkDiscrepancies(xlsxStores, bitableStores) {
  const issues = [];

  // 数量差异
  if (xlsxStores.length !== bitableStores.length) {
    issues.push({
      severity: 'critical',
      type: 'count_mismatch',
      message: `门店数量不一致：xlsx ${xlsxStores.length} 家 vs 门店清单 ${bitableStores.length} 家`,
    });
  }

  // 门店名差异
  const xlsxNameSet = new Set(xlsxStores.map(s => s.name));
  const bitableNameSet = new Set(bitableStores.map(s => s.name));

  const xlsxOnly = [...xlsxNameSet].filter(n => !bitableNameSet.has(n));
  const bitableOnly = [...bitableNameSet].filter(n => !xlsxNameSet.has(n));

  // 过滤掉模糊匹配相同的（如"体验店"vs"体验中心"）
  const realXlsxOnly = xlsxOnly.filter(xn =>
    !bitableOnly.some(bn => storeNameMatch(xn, bn))
  );
  const realBitableOnly = bitableOnly.filter(bn =>
    !xlsxOnly.some(xn => storeNameMatch(bn, xn))
  );

  // 名称近似但不完全一致的（可能需要人工确认）
  const nameVariants = [];
  for (const xn of xlsxOnly) {
    for (const bn of bitableOnly) {
      if (storeNameMatch(xn, bn)) {
        nameVariants.push({ xlsx: xn, bitable: bn });
      }
    }
  }

  if (realXlsxOnly.length > 0) {
    issues.push({
      severity: 'critical',
      type: 'xlsx_extra_stores',
      message: `xlsx 中有 ${realXlsxOnly.length} 家门店不在门店清单中：${realXlsxOnly.join('、')}`,
      stores: realXlsxOnly,
    });
  }

  if (realBitableOnly.length > 0) {
    issues.push({
      severity: 'critical',
      type: 'bitable_extra_stores',
      message: `门店清单中有 ${realBitableOnly.length} 家门店不在 xlsx 中：${realBitableOnly.join('、')}`,
      stores: realBitableOnly,
    });
  }

  if (nameVariants.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'name_variant',
      message: `${nameVariants.length} 对门店名称近似但不一致，需确认是否为同一家`,
      variants: nameVariants,
    });
  }

  // 督导差异：同一门店编码在两个源中的督导不同
  const xlsxByCode = new Map(xlsxStores.map(s => [s.code, s]));
  const bitableByCode = new Map(bitableStores.map(s => [s.code, s]));

  for (const [code, xlsxStore] of xlsxByCode) {
    const bitableStore = bitableByCode.get(code);
    if (bitableStore && xlsxStore.supervisor !== bitableStore.supervisor) {
      issues.push({
        severity: 'critical',
        type: 'supervisor_mismatch',
        message: `${xlsxStore.name}(${code}) 督导不一致：xlsx「${xlsxStore.supervisor}」vs 门店清单「${bitableStore.supervisor}」`,
        store: code,
        xlsxValue: xlsxStore.supervisor,
        bitableValue: bitableStore.supervisor,
      });
    }
  }

  return issues;
}

async function generateExcel(allStores, bySupervisor) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `audit_${dateStr}.xlsx`;
  const filePath = path.join(config.outputDir, fileName);

  const wb = XLSX.utils.book_new();

  // Sheet 1: 汇总
  const summaryData = Object.entries(bySupervisor).map(([name, data]) => ({
    '督导': name,
    '负责门店数': data.total,
    '已登记数': data.registered,
    '未登记数': data.unregistered,
    '登记率': data.total > 0 ? (data.registered / data.total * 100).toFixed(1) + '%' : '0%',
  }));
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, '汇总');

  // Sheet 2: 未登记门店明细
  const detailData = allStores
    .filter(s => !s.registered)
    .map(s => ({
      '门店编码': s.code,
      '门店名称': s.name,
      '区域': s.area,
      '督导': s.supervisor,
    }));
  const detailWs = XLSX.utils.json_to_sheet(detailData);
  XLSX.utils.book_append_sheet(wb, detailWs, '未登记门店明细');

  // 每个督导一个 sheet
  for (const [supName, data] of Object.entries(bySupervisor)) {
    const sheetName = supName.substring(0, 31);
    const supData = data.stores
      .filter(s => !s.registered)
      .map(s => ({
        '门店编码': s.code,
        '门店名称': s.name,
        '区域': s.area,
      }));
    if (supData.length > 0) {
      const ws = XLSX.utils.json_to_sheet(supData);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  }

  XLSX.writeFile(wb, filePath);
  return filePath;
}

function saveAuditLog(result) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const logPath = path.join(config.logsDir, `audit_${dateStr}.json`);

  let history = [];
  try {
    if (fs.existsSync(logPath)) {
      history = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    }
  } catch { /* ignore */ }

  history.push({
    timestamp: result.timestamp,
    totalStores: result.totalStores,
    registeredCount: result.registeredCount,
    unregisteredCount: result.unregisteredCount,
    registrationRate: result.registrationRate,
    discrepancyCount: result.discrepancies.length,
    bySupervisor: Object.fromEntries(
      Object.entries(result.bySupervisor).map(([k, v]) => [k, {
        total: v.total,
        registered: v.registered,
        unregistered: v.unregistered,
      }])
    ),
  });

  fs.writeFileSync(logPath, JSON.stringify(history, null, 2));
}

export function loadAuditHistory(days = 30) {
  const history = [];
  try {
    const files = fs.readdirSync(config.logsDir)
      .filter(f => f.startsWith('audit_') && f.endsWith('.json'))
      .sort()
      .slice(-days);

    for (const f of files) {
      const entries = JSON.parse(fs.readFileSync(path.join(config.logsDir, f), 'utf-8'));
      history.push(...entries);
    }
  } catch { /* no history yet */ }
  return history;
}

export function getLatestExcelPath() {
  try {
    const files = fs.readdirSync(config.outputDir)
      .filter(f => f.startsWith('audit_') && f.endsWith('.xlsx'))
      .sort();
    if (files.length === 0) return null;
    return path.join(config.outputDir, files[files.length - 1]);
  } catch {
    return null;
  }
}
