import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import dashboardRouter from './api/dashboard.js';
import { startScheduler } from './scheduler.js';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 确保必要目录存在
for (const dir of [config.outputDir, config.logsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.use(express.json());

// API 路由
app.use('/api/dashboard', dashboardRouter);

// 静态文件托管（前端构建产物）
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'));
    }
  });
}

// 启动服务
app.listen(config.port, () => {
  console.log(`门店超时提醒登记审计系统已启动: http://localhost:${config.port}`);
});

// 启动定时任务
startScheduler();
