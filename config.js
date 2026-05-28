import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tz = process.env.TZ || 'Asia/Shanghai';
process.env.TZ = tz;

export default {
  tz,
  feishu: {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  },
  bitable: {
    appToken: process.env.BITABLE_APP_TOKEN,
    storeTableId: process.env.STORE_TABLE_ID,
    storeViewId: process.env.STORE_VIEW_ID,
    registrationTableId: process.env.REGISTRATION_TABLE_ID,
    registrationViewId: process.env.REGISTRATION_VIEW_ID,
  },
  storeListPath: path.resolve(__dirname, process.env.STORE_LIST_PATH || './store_list.xlsx'),
  managersConfigPath: path.resolve(__dirname, process.env.MANAGERS_CONFIG_PATH || './config/managers.json'),
  scheduleCron: process.env.SCHEDULE_CRON || '0 17 * * *',
  port: parseInt(process.env.PORT || '3001', 10),
  outputDir: path.resolve(__dirname, 'output'),
  logsDir: path.resolve(__dirname, 'logs'),
};
