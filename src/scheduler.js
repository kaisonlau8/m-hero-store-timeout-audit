import cron from 'node-cron';
import config from '../config.js';
import { runAudit } from './audit.js';
import { notifySupervisors, notifyManagers } from './messenger.js';
import fs from 'fs';
import path from 'path';

async function executeAuditJob() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 定时审计任务开始执行`);

  try {
    const auditResult = await runAudit();
    console.log(`审计完成: 总数=${auditResult.totalStores}, 已登记=${auditResult.registeredCount}, 未登记=${auditResult.unregisteredCount}`);

    // 通知督导
    const supResults = await notifySupervisors(auditResult);
    for (const r of supResults) {
      if (r.status === 'sent') {
        console.log(`  督导 ${r.supervisor}: 已发送（${r.unregisteredCount} 家未登记）`);
      } else {
        console.log(`  督导 ${r.supervisor}: ${r.status} - ${r.reason || ''}`);
      }
    }

    // 通知管理者
    const mgrResults = await notifyManagers(auditResult);
    for (const r of mgrResults) {
      if (r.status === 'sent') {
        console.log(`  管理者 ${r.manager}: 已发送`);
      } else {
        console.log(`  管理者 ${r.manager}: ${r.status} - ${r.reason || ''}`);
      }
    }

    // 写入执行日志
    appendCronLog({
      timestamp,
      status: 'success',
      auditSummary: {
        totalStores: auditResult.totalStores,
        registeredCount: auditResult.registeredCount,
        unregisteredCount: auditResult.unregisteredCount,
        registrationRate: auditResult.registrationRate,
      },
      supervisorNotifications: supResults,
      managerNotifications: mgrResults,
    });

    return auditResult;
  } catch (err) {
    console.error(`审计任务执行失败:`, err);
    appendCronLog({ timestamp, status: 'error', error: err.message });
    throw err;
  }
}

function appendCronLog(entry) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const logPath = path.join(config.logsDir, `cron_${dateStr}.log`);
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf-8');
}

export function startScheduler() {
  const cronExpr = config.scheduleCron;
  if (!cron.validate(cronExpr)) {
    console.error(`无效的 cron 表达式: ${cronExpr}`);
    return;
  }

  cron.schedule(cronExpr, () => {
    executeAuditJob().catch(err => {
      console.error('定时任务异常:', err);
    });
  });

  console.log(`定时任务已启动: ${cronExpr}`);
}

export { executeAuditJob };
