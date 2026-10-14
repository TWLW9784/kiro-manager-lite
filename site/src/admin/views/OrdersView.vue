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
        <el-radio-button value="open">进行中</el-radio-button>
        <el-radio-button value="done">已完成</el-radio-button>
        <el-radio-button value="cancelled">已取消</el-radio-button>
        <el-radio-button value="">全部</el-radio-button>
      </el-radio-group>
      <el-select :empty-values="FILTER_EMPTY" v-model="settle" class="w-150">
        <el-option value="" label="全部结算状态" />
        <el-option v-for="(m, k) in SETTLE_STATUS" :key="k" :value="k" :label="m.text" />
      </el-select>
      <el-button v-if="filtered" @click="reset">重置筛选</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" @row-click="(r: AdminOrder) => (drawerOrder = r.id)">
      <el-table-column label="批次" min-width="160">
        <template #default="{ row }">
          <el-link type="primary" :underline="false">{{ row.code }}</el-link>
          <el-tooltip v-if="row.source === 'offline'" content="线下（TXT / Excel）发出后补建：不从池子领、不自动补" placement="top">
            <el-tag size="small" class="src">线下</el-tag>
          </el-tooltip>
          <div v-if="row.note" class="muted small ellipsis">{{ row.note }}</div>
        </template>
      </el-table-column>
      <el-table-column label="客户" width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row.client ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="档位" width="96">
        <template #default="{ row }">
          {{ row.tier }}
          <div class="muted small">目标 {{ row.quantity }}</div>
        </template>
      </el-table-column>
      <el-table-column label="进度" min-width="190">
        <template #default="{ row }">
          <el-progress
            :percentage="Math.min(100, Math.round((num(row.paid) / Math.max(1, row.quantity)) * 100))"
            :show-text="false"
          />
          <span class="small muted">
            已付 <b class="ok">{{ num(row.paid) }}</b> · 待付 {{ num(row.holding) }}
            <template v-if="num(row.void)"> · 作废 {{ num(row.void) }}</template>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="付客户" width="120" align="right">
        <template #default="{ row }">
          <span class="num">{{ usd(row.due_amount) }}</span>
          <div class="muted small">
            {{ row.unit_price !== null ? `${num(row.paid)} × ${usd(row.unit_price)}` : '按实付' }}
          </div>
          <div class="muted small">实付 {{ usd(row.paid_usd) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="客户赚" width="92" align="right">
        <template #default="{ row }">
          <b v-if="row.unit_price !== null" :class="num(row.client_profit) >= 0 ? 'ok' : 'danger'">
            {{ usd(row.client_profit) }}
          </b>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="结算" width="112">
        <template #default="{ row }">
          <el-tag size="small" :type="SETTLE_STATUS[row.settle_status]?.type || undefined">
            {{ SETTLE_STATUS[row.settle_status]?.text }}
          </el-tag>
          <div v-if="num(row.settled_amount)" class="muted small num">{{ usd(row.settled_amount) }}</div>
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
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
:deep(.el-table__row) { cursor: pointer; }
</style>
