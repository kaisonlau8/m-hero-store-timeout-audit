<template>
  <div class="dashboard">
    <el-container>
      <el-header class="header">
        <h2>门店超时提醒登记审计系统</h2>
        <div class="header-actions">
          <el-button type="primary" :loading="running" @click="runAudit">手动触发审计</el-button>
          <el-button @click="refreshData" :loading="loading">刷新数据</el-button>
          <el-button @click="showConfig = true">配置管理</el-button>
        </div>
      </el-header>

      <el-main v-loading="loading">
        <!-- 数据源差异告警 -->
        <el-alert
          v-for="(d, idx) in criticalDiscrepancies"
          :key="'crit-' + idx"
          :title="d.message"
          type="error"
          show-icon
          :closable="false"
          style="margin-bottom: 8px;"
        />
        <el-alert
          v-for="(d, idx) in warningDiscrepancies"
          :key="'warn-' + idx"
          :title="d.message"
          type="warning"
          show-icon
          :closable="false"
          style="margin-bottom: 8px;"
        />

        <!-- 总览卡片 -->
        <el-row :gutter="16" class="summary-cards">
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="stat-card">
                <div class="stat-value">{{ summary.totalStores }}</div>
                <div class="stat-label">门店总数</div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="stat-card registered">
                <div class="stat-value">{{ summary.registeredCount }}</div>
                <div class="stat-label">已登记门店</div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="stat-card unregistered">
                <div class="stat-value">{{ summary.unregisteredCount }}</div>
                <div class="stat-label">未登记门店</div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card shadow="hover">
              <div class="stat-card rate">
                <div class="stat-value">{{ summary.registrationRate }}</div>
                <div class="stat-label">登记率</div>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="16" style="margin-top: 16px;">
          <!-- 按督导统计 -->
          <el-col :span="14">
            <el-card shadow="hover">
              <template #header>
                <span>各督导登记情况</span>
              </template>
              <el-table :data="supervisorTableData" stripe style="width: 100%">
                <el-table-column prop="name" label="督导" width="100" />
                <el-table-column prop="total" label="负责门店" width="100" align="center" />
                <el-table-column prop="registered" label="已登记" width="100" align="center">
                  <template #default="{ row }">
                    <span style="color: #67c23a;">{{ row.registered }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="unregistered" label="未登记" width="100" align="center">
                  <template #default="{ row }">
                    <span style="color: #f56c6c; font-weight: bold;">{{ row.unregistered }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="登记率" align="center">
                  <template #default="{ row }">
                    <el-progress
                      :percentage="row.total > 0 ? Number((row.registered / row.total * 100).toFixed(1)) : 0"
                      :color="getProgressColor(row.registered / row.total)"
                      :stroke-width="16"
                      :text-inside="true"
                    />
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>

          <!-- 区域分布图 -->
          <el-col :span="10">
            <el-card shadow="hover">
              <template #header>
                <span>区域登记分布</span>
              </template>
              <v-chart :option="areaChartOption" style="height: 320px;" autoresize />
            </el-card>
          </el-col>
        </el-row>

        <!-- 门店列表 -->
        <el-card shadow="hover" style="margin-top: 16px;">
          <template #header>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>门店列表</span>
              <div>
                <el-select v-model="filterSupervisor" placeholder="筛选督导" clearable style="width: 140px; margin-right: 8px;">
                  <el-option v-for="s in supervisorNames" :key="s" :label="s" :value="s" />
                </el-select>
                <el-select v-model="filterArea" placeholder="筛选区域" clearable style="width: 120px; margin-right: 8px;">
                  <el-option v-for="a in areaNames" :key="a" :label="a" :value="a" />
                </el-select>
                <el-select v-model="filterStatus" placeholder="登记状态" clearable style="width: 120px;">
                  <el-option label="已登记" value="registered" />
                  <el-option label="未登记" value="unregistered" />
                </el-select>
              </div>
            </div>
          </template>
          <el-table :data="filteredStores" stripe style="width: 100%" max-height="500">
            <el-table-column prop="code" label="门店编码" width="140" />
            <el-table-column prop="name" label="门店名称" min-width="240" />
            <el-table-column prop="area" label="区域" width="100" />
            <el-table-column prop="supervisor" label="督导" width="100" />
            <el-table-column label="登记状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.registered ? 'success' : 'danger'" size="small">
                  {{ row.registered ? '已登记' : '未登记' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 历史趋势 -->
        <el-card shadow="hover" style="margin-top: 16px;">
          <template #header>
            <span>历史趋势</span>
          </template>
          <v-chart :option="historyChartOption" style="height: 300px;" autoresize />
        </el-card>
      </el-main>
    </el-container>

    <!-- 配置弹窗 -->
    <el-dialog v-model="showConfig" title="配置管理" width="600px">
      <el-form label-width="100px">
        <el-form-item label="定时任务">
          <el-input v-model="configData.scheduleCron" disabled />
          <div class="form-tip">修改定时任务请更新 .env 文件中的 SCHEDULE_CRON</div>
        </el-form-item>
        <el-form-item label="全国收信人">
          <div v-for="(mgr, idx) in configData.managers" :key="idx" style="display: flex; gap: 8px; margin-bottom: 8px;">
            <el-input v-model="mgr.name" placeholder="姓名" style="width: 150px;" />
            <el-input v-model="mgr.phone" placeholder="手机号" style="width: 180px;" />
            <el-button type="danger" circle size="small" @click="configData.managers.splice(idx, 1)">-</el-button>
          </div>
          <el-button type="primary" size="small" @click="configData.managers.push({ name: '', phone: '' })">+ 添加管理者</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showConfig = false">取消</el-button>
        <el-button type="primary" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, DatasetComponent,
} from 'echarts/components';

use([
  CanvasRenderer, BarChart, LineChart, PieChart,
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, DatasetComponent,
]);

const loading = ref(false);
const running = ref(false);
const showConfig = ref(false);

const summary = ref({
  totalStores: 0, registeredCount: 0, unregisteredCount: 0, registrationRate: '0%',
  bySupervisor: {}, byArea: {}, discrepancies: [],
});
const stores = ref([]);
const history = ref([]);
const configData = ref({ scheduleCron: '', managers: [] });

const filterSupervisor = ref('');
const filterArea = ref('');
const filterStatus = ref('');

const supervisorNames = computed(() => Object.keys(summary.value.bySupervisor));
const areaNames = computed(() => Object.keys(summary.value.byArea || {}));

const criticalDiscrepancies = computed(() =>
  (summary.value.discrepancies || []).filter(d => d.severity === 'critical')
);
const warningDiscrepancies = computed(() =>
  (summary.value.discrepancies || []).filter(d => d.severity === 'warning')
);

const supervisorTableData = computed(() =>
  Object.entries(summary.value.bySupervisor).map(([name, data]) => ({ name, ...data }))
);

const filteredStores = computed(() => {
  let list = stores.value;
  if (filterSupervisor.value) list = list.filter(s => s.supervisor === filterSupervisor.value);
  if (filterArea.value) list = list.filter(s => s.area === filterArea.value);
  if (filterStatus.value === 'registered') list = list.filter(s => s.registered);
  if (filterStatus.value === 'unregistered') list = list.filter(s => !s.registered);
  return list;
});

const areaChartOption = computed(() => {
  const areas = Object.entries(summary.value.byArea || {});
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['已登记', '未登记'] },
    xAxis: { type: 'category', data: areas.map(([k]) => k) },
    yAxis: { type: 'value' },
    series: [
      { name: '已登记', type: 'bar', stack: 'total', data: areas.map(([, v]) => v.registered), itemStyle: { color: '#67c23a' } },
      { name: '未登记', type: 'bar', stack: 'total', data: areas.map(([, v]) => v.unregistered), itemStyle: { color: '#f56c6c' } },
    ],
  };
});

const historyChartOption = computed(() => {
  const dates = history.value.map(h => h.timestamp.slice(0, 10));
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['已登记', '未登记', '登记率'] },
    xAxis: { type: 'category', data: dates },
    yAxis: [
      { type: 'value', name: '门店数' },
      { type: 'value', name: '登记率(%)', max: 100 },
    ],
    series: [
      { name: '已登记', type: 'line', data: history.value.map(h => h.registeredCount), smooth: true },
      { name: '未登记', type: 'line', data: history.value.map(h => h.unregisteredCount), smooth: true },
      { name: '登记率', type: 'line', yAxisIndex: 1, data: history.value.map(h => parseFloat(h.registrationRate)), smooth: true, lineStyle: { type: 'dashed' } },
    ],
  };
});

function getProgressColor(ratio) {
  if (ratio >= 0.8) return '#67c23a';
  if (ratio >= 0.5) return '#e6a23c';
  return '#f56c6c';
}

async function loadSummary() {
  const { data } = await axios.get('/api/dashboard/summary');
  if (data.success) summary.value = data.data;
}

async function loadStores() {
  const { data } = await axios.get('/api/dashboard/stores');
  if (data.success) stores.value = data.data;
}

async function loadHistory() {
  const { data } = await axios.get('/api/dashboard/history');
  if (data.success) history.value = data.data;
}

async function loadConfig() {
  const { data } = await axios.get('/api/dashboard/config');
  if (data.success) configData.value = data.data;
}

async function refreshData() {
  loading.value = true;
  try {
    await Promise.all([loadSummary(), loadStores(), loadHistory()]);
  } finally {
    loading.value = false;
  }
}

async function runAudit() {
  running.value = true;
  try {
    await axios.post('/api/dashboard/run');
    await refreshData();
  } finally {
    running.value = false;
  }
}

async function saveConfig() {
  await axios.put('/api/dashboard/config', { managers: configData.value.managers });
  showConfig.value = false;
}

onMounted(() => {
  refreshData();
  loadConfig();
});
</script>

<style scoped>
.dashboard {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 20px 20px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
}
.header h2 {
  margin: 0;
  color: #303133;
}
.summary-cards {
  text-align: center;
}
.stat-card {
  padding: 16px 0;
}
.stat-value {
  font-size: 36px;
  font-weight: bold;
  line-height: 1.2;
}
.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}
.stat-card.registered .stat-value { color: #67c23a; }
.stat-card.unregistered .stat-value { color: #f56c6c; }
.stat-card.rate .stat-value { color: #409eff; }
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
