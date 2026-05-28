import { Router } from 'express';
import { runAudit, loadAuditHistory, getLatestExcelPath } from '../audit.js';
import { executeAuditJob } from '../scheduler.js';
import { getAuditCache, setAuditCache } from '../cache.js';
import config from '../../config.js';
import fs from 'fs';

const router = Router();

async function getOrRunAudit() {
  if (!getAuditCache()) {
    setAuditCache(await runAudit());
  }
  return getAuditCache();
}

// GET /api/dashboard/summary
router.get('/summary', async (req, res) => {
  try {
    const result = await getOrRunAudit();
    res.json({
      success: true,
      data: {
        timestamp: result.timestamp,
        totalStores: result.totalStores,
        registeredCount: result.registeredCount,
        unregisteredCount: result.unregisteredCount,
        registrationRate: result.registrationRate,
        discrepancies: result.discrepancies,
        bySupervisor: Object.fromEntries(
          Object.entries(result.bySupervisor).map(([k, v]) => [k, {
            total: v.total,
            registered: v.registered,
            unregistered: v.unregistered,
          }])
        ),
        byArea: result.byArea,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard/stores?supervisor=&area=&status=
router.get('/stores', async (req, res) => {
  try {
    const result = await getOrRunAudit();
    let stores = result.allStores;

    if (req.query.supervisor) {
      stores = stores.filter(s => s.supervisor === req.query.supervisor);
    }
    if (req.query.area) {
      stores = stores.filter(s => s.area === req.query.area);
    }
    if (req.query.status === 'registered') {
      stores = stores.filter(s => s.registered);
    } else if (req.query.status === 'unregistered') {
      stores = stores.filter(s => !s.registered);
    }

    res.json({ success: true, data: stores });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard/history?days=30
router.get('/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const history = loadAuditHistory(days);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard/export
router.get('/export', (req, res) => {
  const filePath = getLatestExcelPath();
  if (!filePath) {
    return res.status(404).json({ success: false, error: '暂无审计 Excel 文件' });
  }
  res.download(filePath);
});

// POST /api/dashboard/run
router.post('/run', async (req, res) => {
  try {
    const result = await executeAuditJob();
    setAuditCache(result);
    res.json({
      success: true,
      data: {
        timestamp: result.timestamp,
        totalStores: result.totalStores,
        registeredCount: result.registeredCount,
        unregisteredCount: result.unregisteredCount,
        registrationRate: result.registrationRate,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard/config
router.get('/config', (req, res) => {
  try {
    const managers = JSON.parse(fs.readFileSync(config.managersConfigPath, 'utf-8'));
    res.json({
      success: true,
      data: {
        scheduleCron: config.scheduleCron,
        managers,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/dashboard/config
router.put('/config', (req, res) => {
  try {
    const { managers } = req.body;
    if (managers && Array.isArray(managers)) {
      fs.writeFileSync(config.managersConfigPath, JSON.stringify(managers, null, 2));
    }
    const updated = JSON.parse(fs.readFileSync(config.managersConfigPath, 'utf-8'));
    res.json({ success: true, data: { managers: updated } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/dashboard/refresh — 刷新缓存数据
router.post('/refresh', async (req, res) => {
  try {
    setAuditCache(await runAudit());
    res.json({ success: true, data: { timestamp: getAuditCache().timestamp } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
