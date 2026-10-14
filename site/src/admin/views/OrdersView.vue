<script setup lang="ts">
/** 批次：搜索 / 筛选 / 分页，点一行开详情抽屉，右上角派单 */
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { ORDER_STATUS, SETTLE_STATUS, num, usd } from '@site/shared/format'
import { FILTER_EMPTY, clientOptions, loadClients, loadOverview, type AdminOrder } from '../state'
import OrderDrawer from '../components/OrderDrawer.vue'
import OrderModal from '../components/OrderModal.vue'

const props = defineProps<{ clientId?: number; settle?: string; orderId?: number }>()
const emit = defineEmits<{ goto: [view: 'links', params?: Record<string, unknown>] }>()

const rows = ref<AdminOrder[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const status = ref('open')
const settle = ref<string>(props.settle ?? '')
const clientId = ref<number | ''>(props.clientId ?? '')
const q = ref('')
const loading = ref(false)
const drawerOrder = ref<number | null>(props.orderId ?? null)
const creating = ref(false)

const filtered = computed(() => !!clientId.value || !!settle.value || !!q.value.trim() || status.value !== 'open')
/** 完成进度：已付 / 数量 */
const pct = (r: AdminOrder): number => Math.min(100, Math.round((num(r.paid) / Math.max(1, r.quantity)) * 100))

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.admin<{ orders: AdminOrder[]; total: number }>('orders', {
      page: page.value,
      page_size: size.value,
      status: status.value || undefined,
      settle: settle.value || undefined,
      client_id: clientId.value || undefined,
      q: q.value.trim() || undefined
    })
    rows.value = r.orders
    total.value = r.total
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))
const reload = (): void => void guard(load)
const refilter = (): void => {
  page.value = 1
  reload()
}
watch([status, settle, clientId], refilter)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(refilter, 400)
})

function reset(): void {
  clientId.value = ''
  settle.value = ''
  status.value = 'open'
  q.value = ''
}

async function changed(): Promise<void> {
  await guard(async () => {
    await Promise.all([load(), loadClients(), loadOverview()])
  })
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>批次<span class="muted small"> {{ total }}</span></h2>
        <el-button type="primary" :icon="Plus" @click="creating = true">派单</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
      </div>
    </template>

    <div class="toolbar">
      <el-input v-model="q" placeholder="搜批次号 / 备注" clearable class="w-200" />
      <el-select :empty-values="FILTER_EMPTY" v-model="clientId" class="w-150" :options="clientOptions">
        <el-option v-for="o in clientOptions" :key="String(o.value)" :value="o.value" :label="o.label" />
      </el-select>
      <el-radio-group v-model="status">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="open">进行中</el-radio-button>
        <el-radio-button value="done">已完成</el-radio-button>
        <el-radio-button value="cancelled">已取消</el-radio-button>
      </el-radio-group>
      <!-- 结算状态不再单独做筛选框；从别的页面带着条件跳过来时用标签显示，点 × 去掉 -->
      <el-tag v-if="settle" closable @close="settle = ''">结算：{{ SETTLE_STATUS[settle]?.text ?? settle }}</el-tag>
      <el-button v-if="filtered" @click="reset">重置筛选</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" @row-click="(r: AdminOrder) => (drawerOrder = r.id)">
      <!-- 批次 + 客户 + 档位合成一格：原来分三列，客户名还被截断 -->
      <el-table-column label="批次" min-width="220">
        <template #default="{ row }">
          <div class="batch">
            <el-link type="primary" :underline="false">{{ row.code }}</el-link>
            <el-tooltip v-if="row.source === 'offline'" content="线下（TXT / Excel）发出后补建：不从池子领、不自动补" placement="top">
              <el-tag size="small" class="src">线下</el-tag>
            </el-tooltip>
          </div>
          <div class="small"><b>{{ row.client ?? '-' }}</b><span class="muted"> · {{ row.tier }}</span></div>
          <div v-if="row.note" class="muted small ellipsis">{{ row.note }}</div>
        </template>
      </el-table-column>
      <el-table-column label="进度" min-width="200">
        <template #default="{ row }">
          <el-progress :percentage="pct(row)" :show-text="false" />
          <span class="small muted">
            完成 <b class="ok">{{ num(row.paid) }}</b> / {{ row.quantity }} · 待付 {{ num(row.holding) }}
            <template v-if="num(row.void)"> · 作废 {{ num(row.void) }}</template>
          </span>
        </template>
      </el-table-column>
      <!-- 钱：我付了多少、做完了多少。单个批次不判对错：钱常跨批次抵，对账以客户余额为准 -->
      <el-table-column label="钱" min-width="170" align="right">
        <template #default="{ row }">
          <div>已付 <b class="num">{{ usd(row.settled_amount) }}</b></div>
          <div class="muted small">
            <template v-if="row.unit_price !== null">完成 {{ usd(row.due_amount) }} / {{ usd(row.quantity * num(row.unit_price)) }}</template>
            <template v-else>按实付 {{ usd(row.due_amount) }}</template>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="92">
        <template #default="{ row }">
          <el-tag size="small" :type="ORDER_STATUS[row.status]?.type || undefined">{{ ORDER_STATUS[row.status]?.text }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建" width="104">
        <template #default="{ row }"><span class="small muted">{{ row.created_at.slice(5, 16) }}</span></template>
      </el-table-column>
      <el-table-column width="72" align="right">
        <template #default><el-button size="small" text type="primary">详情</el-button></template>
      </el-table-column>
      <template #empty><el-empty description="没有符合条件的批次" /></template>
    </el-table>

    <div v-if="total > size" class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
        @change="reload"
      />
    </div>
  </el-card>

  <OrderDrawer
    v-if="drawerOrder"
    :order-id="drawerOrder"
    @close="drawerOrder = null"
    @changed="changed"
    @goto-links="(p) => emit('goto', 'links', p)"
  />
  <OrderModal v-if="creating" :client-id="clientId || undefined" @close="creating = false" @saved="changed" />
</template>

<style scoped>
.src { margin-left: 6px; }
.batch { display: flex; align-items: center; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
:deep(.el-table__row) { cursor: pointer; }
</style>
