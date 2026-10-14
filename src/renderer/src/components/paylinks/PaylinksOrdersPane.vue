<script setup lang="ts">
/** 派单批次：服务端分页，可按客户 / 状态 / 结算状态筛选、搜批次号；点一行打开详情抽屉（结算、打款、链接、批次操作） */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { FileAddOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import PaylinksOrderModal from '@/components/paylinks/PaylinksOrderModal.vue'
import PaylinksOrderDrawer from '@/components/paylinks/PaylinksOrderDrawer.vue'
import {
  ORDER_STATUS_META,
  SETTLE_STATUS_META,
  filterOptions,
  metaFilterOptions,
  orUndef,
  paylinksAdmin,
  type AdminClient,
  type AdminOrder
} from '@/utils/paylinksAdmin'

const props = defineProps<{ clients: AdminClient[]; active?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
/** 外部（客户列表 / 结算页）可以带着客户、结算状态筛选跳过来 */
// 筛选值：空串 = 全部（a-select 的「全部」项用空串，undefined 会显示成空白）
const clientIdModel = defineModel<number | '' | undefined>('clientId')
const settleModel = defineModel<string | undefined>('settle')
/** 父组件（客户页 / 结算页跳过来）可能传 undefined，这里兜成空串 */
const clientId = computed({
  get: () => clientIdModel.value ?? '',
  set: (v) => (clientIdModel.value = v)
})
const settle = computed({
  get: () => settleModel.value ?? '',
  set: (v) => (settleModel.value = v)
})

const orders = ref<AdminOrder[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const status = ref<string>('open')
const q = ref('')
const creating = ref(false)
const opened = ref<number | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await paylinksAdmin.ordersPage({
      status: orUndef(status.value),
      client_id: orUndef(clientId.value),
      settle: orUndef(settle.value),
      q: q.value.trim() || undefined,
      page: page.value,
      page_size: pageSize.value
    })
    orders.value = r.orders
    total.value = r.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

watch([status, clientIdModel, settleModel], () => { page.value = 1; void load() })
/** 搜索框点 × 清空时立刻生效（a-input-search 的 × 只发 change，不发 search） */
function onSearchChange(e: { target: { value?: string } }): void {
  if (!e.target.value) {
    page.value = 1
    void load()
  }
}
watch([page, pageSize], () => void load())
watch(() => props.active, (on) => on && load(), { immediate: true })

/** 外部打开某个批次（比如从结算记录点批次号） */
function open(id: number): void {
  opened.value = id
}
defineExpose({ open, load })

const n = (v: string | number | null | undefined): number => Number(v ?? 0)
const columns = [
  { title: '批次', key: 'code', width: 170 },
  { title: '客户', key: 'client', width: 110, ellipsis: true },
  { title: '档位', key: 'tier', width: 100 },
  { title: '进度', key: 'progress', width: 200 },
  { title: '应结', key: 'due', width: 90 },
  { title: '结算', key: 'settle', width: 110 },
  { title: '状态', key: 'status', width: 80 },
  { title: '创建', key: 'created', width: 96 },
  { title: '', key: 'act', width: 64 }
]
const clientOptions = computed(() => filterOptions(props.clients.map((c) => ({ value: c.id, label: c.display_name || c.username })), '全部客户'))
const statusOptions = metaFilterOptions(ORDER_STATUS_META, '全部状态')
const settleOptions = metaFilterOptions(SETTLE_STATUS_META, '全部结算状态')
/** 有没有在筛（默认只看进行中，不算） */
const filtered = computed(() => !!clientId.value || !!settle.value || !!q.value.trim() || status.value !== 'open')
function reset(): void {
  clientId.value = ''
  settle.value = ''
  status.value = 'open'
  q.value = ''
  page.value = 1
  void load()
}
const customRow = (r: AdminOrder): Record<string, unknown> => ({ onClick: () => (opened.value = r.id), style: 'cursor: pointer' })

function onChanged(): void {
  void load()
  emit('changed')
}
</script>

<template>
  <a-card size="small" :title="`派单批次（${total}）`">
    <template #extra>
      <a-space wrap>
        <a-input-search
          v-model:value="q"
          placeholder="批次号 / 备注"
          size="small"
          style="width: 150px"
          allow-clear
          @search="() => ((page = 1), load())"
          @change="onSearchChange"
        />
        <a-select v-model:value="clientId" :options="clientOptions" size="small" style="width: 120px" />
        <a-select v-model:value="status" :options="statusOptions" size="small" style="width: 108px" />
        <a-select v-model:value="settle" :options="settleOptions" size="small" style="width: 120px" />
        <a-tooltip title="回到默认：进行中、全部客户">
          <a-button v-if="filtered" size="small" @click="reset">重置筛选</a-button>
        </a-tooltip>
        <a-tooltip title="刷新"><a-button size="small" :loading="loading" @click="load"><template #icon><ReloadOutlined /></template></a-button></a-tooltip>
        <a-button size="small" type="primary" :disabled="!props.clients.length" @click="creating = true">
          <template #icon><FileAddOutlined /></template>派单
        </a-button>
      </a-space>
    </template>
    <a-table
      :columns="columns"
      :data-source="orders"
      :row-key="(r: AdminOrder) => r.id"
      :loading="loading"
      :custom-row="customRow"
      :pagination="{
        current: page, pageSize, total, size: 'small', showSizeChanger: true, pageSizeOptions: ['20', '50', '100'],
        showTotal: (t: number) => `共 ${t} 个`, onChange: (p: number, s: number) => ((page = p), (pageSize = s))
      }"
      size="small"
      :locale="{ emptyText: '没有符合条件的批次' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'code'">
          <a class="code">{{ record.code }}</a>
          <a-tag v-if="record.source === 'offline'" :bordered="false" class="src">线下</a-tag>
          <div v-if="record.note" class="muted small ellipsis">{{ record.note }}</div>
        </template>
        <template v-else-if="column.key === 'client'">{{ record.client ?? '-' }}</template>
        <template v-else-if="column.key === 'tier'">{{ record.tier }}<div class="muted small">目标 {{ record.quantity }}</div></template>
        <template v-else-if="column.key === 'progress'">
          <a-progress :percent="Math.round((n(record.paid) / Math.max(1, record.quantity)) * 100)" size="small" :show-info="false" />
          <span class="small">已付 <b class="ok">{{ n(record.paid) }}</b> · 待付 {{ n(record.holding) }}<template v-if="n(record.void)"> · 作废 {{ n(record.void) }}</template></span>
        </template>
        <template v-else-if="column.key === 'due'">
          <span class="small">${{ n(record.due_amount).toFixed(2) }}</span>
          <div v-if="record.unit_price != null" class="muted small">每条 ${{ n(record.unit_price).toFixed(2) }}</div>
        </template>
        <template v-else-if="column.key === 'settle'">
          <a-tag :color="SETTLE_STATUS_META[record.settle_status as keyof typeof SETTLE_STATUS_META]?.color" :bordered="false">
            {{ SETTLE_STATUS_META[record.settle_status as keyof typeof SETTLE_STATUS_META]?.text }}
          </a-tag>
          <div v-if="n(record.settled_amount)" class="muted small">${{ n(record.settled_amount).toFixed(2) }}</div>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-badge :status="ORDER_STATUS_META[record.status as AdminOrder['status']].color as any" :text="ORDER_STATUS_META[record.status as AdminOrder['status']].text" />
        </template>
        <template v-else-if="column.key === 'created'"><span class="small">{{ record.created_at.slice(5, 16) }}</span></template>
        <template v-else-if="column.key === 'act'"><a-button type="link" size="small">详情</a-button></template>
      </template>
    </a-table>
  </a-card>
  <PaylinksOrderDrawer v-if="opened" :order-id="opened" :clients="props.clients" @changed="onChanged" @close="opened = null" />
  <PaylinksOrderModal v-if="creating" :clients="props.clients" :client-id="orUndef(clientId)" @saved="onChanged" @close="creating = false" />
</template>

<style scoped>
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.ok { color: #52c41a; }
.code { font-weight: 600; }
.src { margin-left: 4px; font-size: 11px; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
</style>
