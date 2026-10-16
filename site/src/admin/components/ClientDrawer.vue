<script setup lang="ts">
/**
 * 客户详情：这个客户的钱算清了没有，一眼看出来。
 * 钱经常跨批次抵（比如 203 = 20 个 × $10 + 上次欠的 $3），所以对账看客户总余额，
 * 不看单个批次。下面列他的批次和打款流水。
 */
import { computed, onMounted, ref } from 'vue'
import { Edit, Plus, Wallet } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { copyText, dt, num, ORDER_STATUS, usd, walletFresh } from '@site/shared/format'
import { drawerSize, useViewport } from '@site/shared/responsive'
import { ElMessage } from 'element-plus'
import type { AdminClient, AdminOrder } from '../state'
import SettlementTable, { type Settlement } from './SettlementTable.vue'

const props = defineProps<{ client: AdminClient }>()
const emit = defineEmits<{
  close: []
  changed: []
  dispatch: []
  pay: []
  edit: []
  'open-order': [id: number]
}>()

const { width: vw } = useViewport()
const size = computed(() => drawerSize(vw.value, 820))

const loading = ref(true)
const orders = ref<AdminOrder[]>([])
const settlements = ref<Settlement[]>([])

async function load(): Promise<void> {
  loading.value = true
  try {
    const [o, s] = await Promise.all([
      api.admin<{ orders: AdminOrder[] }>('orders', { client_id: props.client.id, page: 1, page_size: 100 }),
      api.admin<{ settlements: Settlement[] }>('settlements', { client_id: props.client.id, page: 1, page_size: 100 })
    ])
    orders.value = o.orders
    settlements.value = s.settlements
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))

async function changed(): Promise<void> {
  await guard(load)
  emit('changed')
}

/** 余额 = 已付客户 − 完成的价值。正：他手里有你预付的钱；负：你还欠他 */
const balance = computed(() => num(props.client.balance))
const verdict = computed(() => {
  const b = balance.value
  if (Math.abs(b) < 0.005) return { text: '已平', cls: 'muted', tip: '付的钱和他完成的正好相等' }
  return b > 0
    ? { text: `他手里有你预付的 ${usd(b)}`, cls: 'primary', tip: '再派批次时可以少付这么多，或者等他继续完成' }
    : { text: `你还欠他 ${usd(-b)}`, cls: 'warn', tip: '他完成的比你付的多，记得打款' }
})
const openOrders = computed(() => orders.value.filter((o) => o.status === 'open').length)
const pct = (r: AdminOrder): number => Math.min(100, Math.round((num(r.paid) / Math.max(1, r.quantity)) * 100))
</script>
<template>
  <el-drawer :model-value="true" :size="size" @close="emit('close')">
    <template #header>
      <div class="title">
        <b>{{ props.client.display_name || props.client.username }}</b>
        <span class="muted small">{{ props.client.username }}</span>
        <el-tag v-if="!props.client.enabled" size="small">已停用</el-tag>
      </div>
    </template>

    <div v-loading="loading" class="body">
      <!-- 对账结论放最上面 -->
      <div class="verdict" :class="verdict.cls">
        <div class="verdict-main">{{ verdict.text }}</div>
        <div class="muted small">
          已付他 {{ usd(props.client.settled) }} · 他完成的价值 {{ usd(props.client.due) }} · {{ verdict.tip }}
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" :icon="Plus" @click="emit('dispatch')">派单</el-button>
        <el-button :icon="Wallet" @click="emit('pay')">记一笔打款</el-button>
        <el-button :icon="Edit" @click="emit('edit')">编辑资料</el-button>
      </div>

      <el-descriptions :column="vw > 640 ? 3 : 1" border size="small">
        <el-descriptions-item label="完成">
          {{ num(props.client.paid) }} 个 <span class="muted small">· 今日 {{ num(props.client.paid_today) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="手里待付">{{ num(props.client.claimed) }} 条</el-descriptions-item>
        <el-descriptions-item label="进行中批次">{{ openOrders }} 个</el-descriptions-item>
        <el-descriptions-item label="他在 Stripe 实付">{{ usd(props.client.client_paid) }}</el-descriptions-item>
        <el-descriptions-item label="他赚了">
          <b :class="num(props.client.client_profit) >= 0 ? 'ok' : 'danger'">{{ usd(props.client.client_profit) }}</b>
        </el-descriptions-item>
        <el-descriptions-item label="收款地址">
          <template v-if="props.client.wallet_address">
            <span class="mono addr" @click="copyText(props.client.wallet_address), ElMessage.success('已复制地址')">
              {{ props.client.wallet_address }}
            </span>
            <el-tag v-if="props.client.wallet_network !== 'polygon'" size="small" type="danger">不是 Polygon</el-tag>
            <el-tag v-else-if="walletFresh(props.client.wallet_updated_at)" size="small" type="danger">24 小时内改过</el-tag>
          </template>
          <el-tag v-else size="small" type="warning">未设置</el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <el-card shadow="never">
        <template #header><h2 class="head">他的批次<span class="muted small"> {{ orders.length }}</span></h2></template>
        <el-table :data="orders" size="small" @row-click="(r: AdminOrder) => emit('open-order', r.id)">
          <el-table-column label="批次" min-width="130">
            <template #default="{ row }">
              <el-link type="primary" :underline="false">{{ row.code }}</el-link>
              <div class="muted small">{{ row.tier }} · {{ dt(row.created_at).slice(0, 5) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="进度" min-width="150">
            <template #default="{ row }">
              <el-progress :percentage="pct(row)" :show-text="false" />
              <span class="small muted">完成 {{ num(row.paid) }} / {{ row.quantity }}</span>
            </template>
          </el-table-column>
          <el-table-column label="已付 / 完成价值" min-width="140" align="right">
            <template #default="{ row }">
              <span class="num">{{ usd(row.settled_amount) }}</span>
              <div class="muted small">{{ usd(row.due_amount) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="84">
            <template #default="{ row }">
              <el-tag size="small" :type="ORDER_STATUS[row.status]?.type || undefined">{{ ORDER_STATUS[row.status]?.text }}</el-tag>
            </template>
          </el-table-column>
          <template #empty><el-empty :image-size="64" description="还没给他派过批次" /></template>
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header><h2 class="head">打款记录<span class="muted small"> {{ settlements.length }}</span></h2></template>
        <SettlementTable
          :rows="settlements"
          :with-client="false"
          @changed="changed"
          @open-order="(id: number) => emit('open-order', id)"
        />
      </el-card>
    </div>
  </el-drawer>
</template>

<style scoped>
.title { display: flex; align-items: center; gap: 8px; }
.body { display: flex; flex-direction: column; gap: 14px; }
.head { margin: 0; font-size: 15px; font-weight: 600; }
.verdict {
  padding: 12px 14px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
  border-left: 3px solid var(--el-border-color);
}
.verdict.primary { background: var(--el-color-primary-light-9); border-left-color: var(--el-color-primary); }
.verdict.warn { background: var(--el-color-warning-light-9); border-left-color: var(--el-color-warning); }
.verdict-main { font-size: 18px; font-weight: 600; margin-bottom: 2px; }
.verdict.primary .verdict-main { color: var(--el-color-primary); }
.verdict.warn .verdict-main { color: var(--el-color-warning); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.addr { cursor: pointer; word-break: break-all; }
.addr:hover { color: var(--el-color-primary); }
:deep(.el-table__row) { cursor: pointer; }
</style>
