#!/usr/bin/env node
/**
 * 覆写脚本：将 xlsx 内容覆写到飞书门店清单多维表格
 * xlsx 为唯一正确依据，bitable 以 xlsx 为准完全对齐
 *
 * 用法：
 *   node src/sync-stores.js --dry-run   预览变更，不写入
 *   node src/sync-stores.js --run       执行覆写
 */

import config from '../config.js';
import { listRecords, batchCreateRecords, batchUpdateRecords, batchDeleteRecords } from 'feishu-bitable-middleware/src/services/feishu.js';
import XLSX from 'xlsx';

const DRY_RUN = process.argv.includes('--dry-run');
const RUN = process.argv.includes('--run');

if (!DRY_RUN && !RUN) {
  console.log('用法:');
  console.log('  node src/sync-stores.js --dry-run   预览变更');
  console.log('  node src/sync-stores.js --run       执行覆写');
  process.exit(1);
}

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

async function sync() {
  console.log(`模式: ${DRY_RUN ? '预览(dry-run)' : '执行(run)'}`);
  console.log(`xlsx 路径: ${config.storeListPath}`);
  console.log(`目标表格: 门店清单 (${config.bitable.storeTableId})\n`);

  // 1. 读取 xlsx
  const wb = XLSX.readFile(config.storeListPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const xlsxData = XLSX.utils.sheet_to_json(ws);
  console.log(`xlsx 门店数: ${xlsxData.length}`);

  // 2. 读取 bitable
  const bitableRecords = await fetchAllRecords(config.bitable.storeTableId, config.bitable.storeViewId);
  console.log(`bitable 门店数: ${bitableRecords.length}\n`);

  // 3. 以门店编码为唯一键建立索引
  const xlsxMap = new Map();
  for (const row of xlsxData) {
    const code = String(row['门店编码'] || '').trim();
    if (!code) continue;
    xlsxMap.set(code, {
      name: String(row['门店名称'] || '').trim(),
      code,
      area: String(row['区域'] || '').trim(),
      supervisor: String(row['督导'] || '').trim(),
    });
  }

  const bitableMap = new Map();
  for (const r of bitableRecords) {
    const code = String(r.fields['门店编码'] || '').trim();
    if (!code) continue;
    bitableMap.set(code, r);
  }

  // 4. 计算差异
  const toCreate = [];   // xlsx 有 bitable 无
  const toUpdate = [];   // 两者都有但内容不同
  const toDelete = [];   // bitable 有 xlsx 无

  for (const [code, xlsxStore] of xlsxMap) {
    const bitableRec = bitableMap.get(code);
    if (!bitableRec) {
      toCreate.push(xlsxStore);
    } else {
      const changes = diffFields(xlsxStore, bitableRec);
      if (changes) {
        toUpdate.push({ record_id: bitableRec.record_id, changes, oldFields: bitableRec.fields });
      }
    }
  }

  for (const [code, bitableRec] of bitableMap) {
    if (!xlsxMap.has(code)) {
      toDelete.push(bitableRec);
    }
  }

  // 5. 输出变更预览
  if (toCreate.length > 0) {
    console.log(`=== 新增门店 (${toCreate.length}) ===`);
    for (const s of toCreate) {
      console.log(`  + ${s.code} ${s.name} | ${s.area} | ${s.supervisor}`);
    }
  }

  if (toUpdate.length > 0) {
    console.log(`\n=== 更新门店 (${toUpdate.length}) ===`);
    for (const u of toUpdate) {
      console.log(`  ~ ${u.record_id}`);
      for (const [field, { old, new: newVal }] of Object.entries(u.changes)) {
        console.log(`    ${field}: "${old}" → "${newVal}"`);
      }
    }
  }

  if (toDelete.length > 0) {
    console.log(`\n=== 删除门店 (${toDelete.length}) ===`);
    for (const r of toDelete) {
      console.log(`  - ${r.fields['门店编码']} ${r.fields['门店名称']}`);
    }
  }

  if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
    console.log('\n无差异，bitable 已与 xlsx 完全一致。');
    return;
  }

  console.log(`\n合计: 新增 ${toCreate.length} | 更新 ${toUpdate.length} | 删除 ${toDelete.length}`);

  if (DRY_RUN) {
    console.log('\n以上为预览，未写入 bitable。使用 --run 执行覆写。');
    return;
  }

  // 6. 执行写入
  console.log('\n开始执行覆写...');

  // 6a. 批量新增
  if (toCreate.length > 0) {
    const records = toCreate.map(s => ({
      fields: {
        '门店名称': s.name,
        '门店编码': s.code,
        '区域': s.area,
        '服务督导': s.supervisor,
      },
    }));

    // 分批 500
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500);
      await batchCreateRecords(batch, { tableId: config.bitable.storeTableId });
      console.log(`  新增 ${Math.min(i + 500, records.length)}/${records.length}`);
    }
  }

  // 6b. 批量更新
  if (toUpdate.length > 0) {
    const records = toUpdate.map(u => ({
      record_id: u.record_id,
      fields: Object.fromEntries(
        Object.entries(u.changes).map(([k, v]) => [k, v.new])
      ),
    }));

    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500);
      await batchUpdateRecords(batch, { tableId: config.bitable.storeTableId });
      console.log(`  更新 ${Math.min(i + 500, records.length)}/${records.length}`);
    }
  }

  // 6c. 批量删除
  if (toDelete.length > 0) {
    const ids = toDelete.map(r => r.record_id);

    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      await batchDeleteRecords(batch, { tableId: config.bitable.storeTableId });
      console.log(`  删除 ${Math.min(i + 500, ids.length)}/${ids.length}`);
    }
  }

  console.log('\n覆写完成！');
}

function diffFields(xlsxStore, bitableRec) {
  const changes = {};

  if (bitableRec.fields['门店名称'] !== xlsxStore.name) {
    changes['门店名称'] = { old: bitableRec.fields['门店名称'], new: xlsxStore.name };
  }

  if (bitableRec.fields['区域'] !== xlsxStore.area) {
    changes['区域'] = { old: bitableRec.fields['区域'], new: xlsxStore.area };
  }

  if (bitableRec.fields['服务督导'] !== xlsxStore.supervisor) {
    changes['服务督导'] = { old: bitableRec.fields['服务督导'], new: xlsxStore.supervisor };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

sync().catch(err => {
  console.error('覆写脚本执行失败:', err);
  process.exit(1);
});
