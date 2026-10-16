<script setup lang="ts">
/** 我的批次：按状态 / 结算状态筛，点一行看详情 */
import { computed, onMounted, ref, watch } from 'vue'
import { tick } from '../state'
import { Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { dt, num, ORDER_STATUS, SETTLE_STATUS, usd } from '@site/shared/format'
import { useViewport } from '@site/shared/responsive'
import { tt } from '../i18n'
import OrderDrawer from '../components/OrderDrawer.vue'

interface Order {
  id: number
  code: string
  tier: string
  quantity: number
  status: string
  source: string
  note: string
  created_at: string
  settle_status: string
  settled_amount: string
  unit_price: string | null
  due_amount: string
  profit: string
  paid: string
  holding: string
  void: string
  remaining: number
}

const rows = ref<Order[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const status = ref('')
// 'all' 而不是空串：Element Plus 把空串当「没选」，会退回显示英文 placeholder
const settle = ref('all')
// 手机上这张表完整要 1010px，窗口只有 324px。把档位折进「批次」列、
// 隐掉创建时间，少让客户横拖一半距离（已付金额留着——利润在那一列）
const { width: vw } = useViewport()
const compact = computed(() => vw.value <= 860)
const loading = ref(false)
const drawerOrder = ref<number | null>(null)

/** silent：自动刷新用，不转圈 */
async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    const r = await api.get<{ orders: Order[]; total: number }>('my_orders', {
      page: page.value,
      page_size: size.value,
      status: status.value,
      settle: settle.value === 'all' ? '' : settle.value
    })
    rows.value = r.orders
    total.value = r.total
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))
// 自动刷新：原地拉数据，不重建页面（筛选、页码、打开的详情都保留）
watch(tick, () => void guard(() => load(true)))
const reload = (): void => void guard(load)
const refilter = (): void => {
  page.value = 1
  reload()
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>{{ tt('nav_orders') }}<span class="muted small"> {{ total }}</span></h2>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
      </div>
    </template>

    <div class="toolbar">
      <el-radio-group v-model="status" size="small" @change="refilter">
        <el-radio-button value="">{{ tt('all') }}</el-radio-button>
        <el-radio-button value="open">{{ tt('order_open') }}</el-radio-button>
        <el-radio-button value="done">{{ tt('order_done') }}</el-radio-button>
        <el-radio-button value="cancelled">{{ tt('order_cancelled') }}</el-radio-button>
      </el-radio-group>
      <el-select v-model="settle" class="w-180" @change="refilter">
        <el-option value="all" :label="tt('settle_all')" />
        <el-option v-for="k in ['unsettled', 'partial', 'settled', 'prepaid']" :key="k" :value="k" :label="tt(`settle_${k}`)" />
      </el-select>
    </div>

    <el-table v-loading="loading" :data="rows" @row-click="(r: Order) => (drawerOrder = r.id)">
      <el-table-column :label="tt('col_batch')" min-width="160">
        <template #default="{ row }">
          <el-link type="primary" :underline="false">{{ row.code }}</el-link>
          <el-tag v-if="row.source === 'offline'" size="small" class="src">{{ tt('source_offline') }}</el-tag>
          <!-- 窄屏把档位 / 目标数折到这里，不另占一列 -->
          <div v-if="compact" class="muted small">{{ row.tier }} · {{ tt('col_target') }} {{ row.quantity }}</div>
          <div v-if="row.note" class="muted small ellipsis">{{ row.note }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="!compact" :label="tt('col_tier')" width="110">
        <template #default="{ row }">
          {{ row.tier }}
          <div class="muted small">{{ tt('col_target') }} {{ row.quantity }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_progress')" min-width="200">
        <template #default="{ row }">
          <el-progress
            :percentage="Math.min(100, Math.round((num(row.paid) / Math.max(1, row.quantity)) * 100))"
            :show-text="false"
          />
          <span class="small muted">
            {{ tt('progress_short', { paid: num(row.paid), qty: row.quantity, holding: num(row.holding) }) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_paid_amount')" width="130" align="right">
        <template #default="{ row }">
          <div class="num">{{ usd(row.due_amount) }}</div>
          <div class="muted small">
            {{ row.unit_price !== null ? tt('per_link', { p: usd(row.unit_price) }) : tt('settle_by_amount') }}
          </div>
          <div v-if="row.unit_price !== null" class="small">
            {{ tt('col_profit') }} <b class="ok">{{ usd(row.profit) }}</b>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_status')" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="ORDER_STATUS[row.status]?.type || undefined">{{ tt(`order_${row.status}`) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_settle')" width="120">
        <template #default="{ row }">
          <el-tag size="small" :type="SETTLE_STATUS[row.settle_status]?.type || undefined">
            {{ tt(`settle_${row.settle_status}`) }}
          </el-tag>
          <div v-if="num(row.settled_amount)" class="muted small num">{{ usd(row.settled_amount) }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="!compact" :label="tt('col_created')" width="110">
        <template #default="{ row }"><span class="small muted">{{ dt(row.created_at) }}</span></template>
      </el-table-column>
      <el-table-column width="80" align="right">
        <template #default><el-button size="small" text type="primary">{{ tt('details') }}</el-button></template>
      </el-table-column>
      <template #empty>
        <el-empty :image-size="72" :description="`${tt('no_orders')}｜${tt('no_orders_tip')}`" />
      </template>
    </el-table>

    <div v-if="total > size" class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @change="reload"
      />
    </div>
  </el-card>

  <OrderDrawer v-if="drawerOrder" :order-id="drawerOrder" @close="drawerOrder = null" @changed="reload" />
</template>

<style scoped>
.src { margin-left: 6px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
:deep(.el-table__row) { cursor: pointer; }
</style>
