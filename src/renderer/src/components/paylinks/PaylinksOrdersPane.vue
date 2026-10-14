<script setup lang="ts">
/** 派单批次：列表、派单、调更换次数、标记完成、取消；点批次号看这个批次的全部链接 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { FileAddOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import PaylinksOrderModal from '@/components/paylinks/PaylinksOrderModal.vue'
import PaylinksOrderLinksModal from '@/components/paylinks/PaylinksOrderLinksModal.vue'
import { confirmDanger } from '@/utils/ui'
import { ORDER_STATUS_META, paylinksAdmin, type AdminClient, type AdminOrder } from '@/utils/paylinksAdmin'

const props = defineProps<{ clients: AdminClient[]; active?: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const orders = ref<AdminOrder[]>([])
const loading = ref(false)
const status = ref<string | undefined>('open')
const clientId = ref<number | undefined>(undefined)
const creating = ref(false)
const viewing = ref<AdminOrder | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    orders.value = await paylinksAdmin.orders({ status: status.value, client_id: clientId.value })
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

watch([status, clientId], () => void load())
watch(() => props.active, (on) => on && load(), { immediate: true })

const n = (v: string | number | null | undefined): number => Number(v ?? 0)
const columns = [
  { title: '批次', key: 'code', width: 120 },
  { title: '客户', key: 'client', ellipsis: true },
  { title: '档位 × 数量', key: 'tier', width: 110 },
  { title: '进度', key: 'progress', width: 190 },
  { title: '更换', key: 'replace', width: 90 },
  { title: '金额', key: 'amount', width: 110 },
  { title: '状态', key: 'status', width: 80 },
  { title: '创建', key: 'created', width: 100 },
  { title: '', key: 'actions', width: 150 }
]

const clientOptions = computed(() => props.clients.map((c) => ({ value: c.id, label: c.display_name || c.username })))

async function changeLimit(order: AdminOrder, value: number | null): Promise<void> {
  if (value == null || value === order.replace_limit) return
  try {
    await paylinksAdmin.updateOrder({ id: order.id, replace_limit: value })
    message.success('已修改更换次数')
    await load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

function finish(order: AdminOrder): void {
  const holding = n(order.holding)
  confirmDanger({
    title: `标记批次 ${order.code} 为完成`,
    content: holding ? `之后不能再领；客户手里还没付的 ${holding} 条照样留着可以付，付了照常结算。` : '之后不能再领。',
    okText: '标记完成',
    onOk: async () => {
      await paylinksAdmin.updateOrder({ id: order.id, status: 'done' })
      message.success('已标记完成')
      await load()
      emit('changed')
    }
  })
}

function cancel(order: AdminOrder): void {
  confirmDanger({
    title: `取消批次 ${order.code}`,
    content: '客户手里没付的链接会收回并换新，已付款的照常结算。',
    okText: '取消批次',
    onOk: async () => {
      await paylinksAdmin.updateOrder({ id: order.id, status: 'cancelled' })
      message.success('已取消')
      await load()
      emit('changed')
    }
  })
}
</script>

<template>
  <a-card size="small" :title="`派单批次（${orders.length}）`">
    <template #extra>
      <a-space>
        <a-select v-model:value="clientId" allow-clear placeholder="全部客户" :options="clientOptions" size="small" style="width: 140px" />
        <a-select
          v-model:value="status"
          allow-clear
          placeholder="全部状态"
          size="small"
          style="width: 110px"
          :options="Object.entries(ORDER_STATUS_META).map(([value, m]) => ({ value, label: m.text }))"
        />
        <a-button size="small" :loading="loading" @click="load"><template #icon><ReloadOutlined /></template></a-button>
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
      :pagination="{ pageSize: 20, size: 'small', hideOnSinglePage: true }"
      size="small"
      :locale="{ emptyText: '没有批次，点右上角「派单」' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'code'">
          <a class="code" @click="viewing = record">{{ record.code }}</a>
          <a-tag v-if="record.source === 'offline'" :bordered="false" class="src-tag">线下发出</a-tag>
          <div v-if="record.note" class="muted small">{{ record.note }}</div>
        </template>
        <template v-else-if="column.key === 'client'">{{ record.client ?? '-' }}</template>
        <template v-else-if="column.key === 'tier'">{{ record.tier }} × {{ record.quantity }}</template>
        <template v-else-if="column.key === 'progress'">
          <a-progress :percent="Math.round((n(record.paid) / Math.max(1, record.quantity)) * 100)" size="small" :show-info="false" />
          <span class="small">
            已付 <b class="ok">{{ n(record.paid) }}</b> · 待付 {{ n(record.holding) }}
            <template v-if="n(record.void)"> · 作废 {{ n(record.void) }}</template>
            <template v-if="record.source !== 'offline' && record.status === 'open'">
              · 可领 {{ Math.max(0, record.quantity - n(record.paid) - n(record.holding)) }}
            </template>
          </span>
        </template>
        <template v-else-if="column.key === 'replace'">
          <span class="small">{{ record.replaced }} / </span>
          <a-input-number
            :value="record.replace_limit"
            :min="0"
            :max="1000"
            size="small"
            style="width: 56px"
            :disabled="record.status !== 'open'"
            @blur="(e: FocusEvent) => changeLimit(record, Number((e.target as HTMLInputElement).value))"
          />
        </template>
        <template v-else-if="column.key === 'amount'">
          <div class="small">${{ n(record.paid_usd).toFixed(2) }}</div>
          <div class="muted small">¥{{ n(record.paid_cny).toFixed(2) }}</div>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-badge :status="ORDER_STATUS_META[record.status as AdminOrder['status']].color as any" :text="ORDER_STATUS_META[record.status as AdminOrder['status']].text" />
        </template>
        <template v-else-if="column.key === 'created'"><span class="small">{{ record.created_at.slice(5, 16) }}</span></template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="viewing = record">查看</a-button>
          <template v-if="record.status === 'open'">
            <a-button type="link" size="small" @click="finish(record)">完成</a-button>
            <a-button type="link" size="small" danger @click="cancel(record)">取消</a-button>
          </template>
        </template>
      </template>
    </a-table>
  </a-card>
  <PaylinksOrderLinksModal v-if="viewing" :order="viewing" @close="viewing = null" />
  <PaylinksOrderModal v-if="creating" :clients="props.clients" :client-id="clientId" @saved="load(); emit('changed')" @close="creating = false" />
</template>

<style scoped>
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.ok { color: #52c41a; }
.code { font-weight: 600; }
.src-tag { margin-left: 4px; font-size: 11px; }
</style>
