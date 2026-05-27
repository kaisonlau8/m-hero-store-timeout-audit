import config from '../config.js';
import fs from 'fs';

const BASE_URL = 'https://open.feishu.cn';

// ── Token 管理 ──
let tokenCache = { token: null, expiresAt: 0 };

async function getTenantAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await fetch(`${BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败: ${data.msg}`);
  }
  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 300) * 1000,
  };
  return tokenCache.token;
}

async function feishuRequest(method, path, body) {
  const token = await getTenantAccessToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  if (data.code !== 0) {
    const err = new Error(`飞书 API 错误 [${method} ${path}]: code=${data.code} msg=${data.msg}`);
    err.code = data.code;
    throw err;
  }
  return data;
}

// ── 手机号 → open_id ──
// 飞书 API: GET /open-apis/contact/v3/users/get_by_phone_number?mobile=xxx&user_id_type=open_id
const phoneCache = new Map();

export async function resolvePhoneToOpenId(phone) {
  if (phoneCache.has(phone)) return phoneCache.get(phone);

  try {
    const resp = await feishuRequest('POST', '/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id', {
      mobiles: [phone],
    });

    const userList = resp.data?.user_list;
    if (!userList || userList.length === 0 || !userList[0].user_id) {
      console.error(`手机号 ${phone} 解析 open_id 失败: 无返回用户`);
      phoneCache.set(phone, null);
      return null;
    }

    const openId = userList[0].user_id;
    phoneCache.set(phone, openId);
    return openId;
  } catch (err) {
    console.error(`手机号 ${phone} 解析 open_id 失败: ${err.message}`);
    phoneCache.set(phone, null);
    return null;
  }
}

// ── 发送私聊消息 ──
// 飞书 API: POST /open-apis/im/v1/messages?receive_id_type=open_id
// receive_id 直接传 open_id，无需先建 P2P 群
export async function sendFeishuMessage(openId, cardContent) {
  await feishuRequest('POST', '/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: openId,
    msg_type: 'interactive',
    content: JSON.stringify(cardContent),
  });
}

// ── 构建督导通知卡片 ──
function buildSupervisorCard(supervisorName, unregisteredStores, totalCount) {
  const storeLines = unregisteredStores
    .map(s => `- ${s.code} ${s.name}（${s.area}）`)
    .join('\n');

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { content: `超时提醒登记提醒`, tag: 'plain_text' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'markdown',
        content: `**${supervisorName}** 您好，以下门店尚未在「超时提醒专属名称」表中登记：`,
      },
      {
        tag: 'markdown',
        content: storeLines,
      },
      {
        tag: 'markdown',
        content: `---\n您负责 **${totalCount}** 家门店，其中 **${unregisteredStores.length}** 家未登记，请尽快补充。`,
      },
    ],
  };
}

// ── 构建管理者汇总卡片 ──
function buildManagerCard(auditResult) {
  const supervisorLines = Object.entries(auditResult.bySupervisor)
    .map(([name, data]) =>
      `- **${name}**：负责 ${data.total} 家，已登记 ${data.registered}，未登记 ${data.unregistered}（${data.total > 0 ? (data.registered / data.total * 100).toFixed(1) : 0}%）`
    )
    .join('\n');

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { content: `全国门店超时提醒登记日报`, tag: 'plain_text' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: `**总览**\n- 门店总数：**${auditResult.totalStores}**\n- 已登记：**${auditResult.registeredCount}**\n- 未登记：**${auditResult.unregisteredCount}**\n- 登记率：**${auditResult.registrationRate}**`,
      },
      {
        tag: 'markdown',
        content: `**各督导登记情况**\n${supervisorLines}`,
      },
      {
        tag: 'markdown',
        content: `---\n已通知各督导尽快补充登记。`,
      },
    ],
  };
}

// ── 通知督导 ──
export async function notifySupervisors(auditResult) {
  const results = [];
  const phones = auditResult.supervisorPhones || {};

  for (const [supervisorName, data] of Object.entries(auditResult.bySupervisor)) {
    const unregisteredStores = data.stores.filter(s => !s.registered);
    if (unregisteredStores.length === 0) {
      results.push({ supervisor: supervisorName, status: 'skipped', reason: '全部已登记' });
      continue;
    }

    const phone = phones[supervisorName];
    if (!phone) {
      results.push({ supervisor: supervisorName, status: 'failed', reason: '未找到手机号' });
      continue;
    }

    try {
      const openId = await resolvePhoneToOpenId(phone);
      if (!openId) {
        results.push({ supervisor: supervisorName, status: 'failed', reason: `手机号 ${phone} 解析 open_id 失败` });
        continue;
      }

      const card = buildSupervisorCard(supervisorName, unregisteredStores, data.total);
      await sendFeishuMessage(openId, card);
      results.push({ supervisor: supervisorName, status: 'sent', unregisteredCount: unregisteredStores.length });
    } catch (err) {
      results.push({ supervisor: supervisorName, status: 'error', reason: err.message });
    }
  }

  return results;
}

// ── 通知管理者 ──
export async function notifyManagers(auditResult) {
  const results = [];

  let managers = [];
  try {
    managers = JSON.parse(fs.readFileSync(config.managersConfigPath, 'utf-8'));
  } catch {
    return results;
  }

  if (managers.length === 0) return results;

  const card = buildManagerCard(auditResult);

  for (const manager of managers) {
    try {
      const formattedPhone = manager.phone.startsWith('+') ? manager.phone : `+86${manager.phone}`;
      const openId = await resolvePhoneToOpenId(formattedPhone);
      if (!openId) {
        results.push({ manager: manager.name, status: 'failed', reason: 'open_id 解析失败' });
        continue;
      }
      await sendFeishuMessage(openId, card);
      results.push({ manager: manager.name, status: 'sent' });
    } catch (err) {
      results.push({ manager: manager.name, status: 'error', reason: err.message });
    }
  }

  return results;
}
