<script setup lang="ts">
/** 批次明细：这个批次里的每一条（待付 / 确认中 / 已付 / 已作废），派单批次里点「查看」打开 */
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { copyText } from '@/utils/ui'
import { LINK_STATUS_META, paylinksAdmin, type AdminLink, type AdminOrder } from '@/utils/paylinksAdmin'

const props = defineProps<{ order: AdminOrder }>()
const emit = defineEmits<{ close: [] }>()

const links = ref<AdminLink[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const r = await paylinksAdmin.links({ order_id: props.order.id, include_void: 1, page_size: 500 })
    // 待付在前，然后已付，作废的放最后
    const rank: Record<string, number> = { claimed: 0, checking: 1, paid: 2, refresh: 3, superseded: 4 }
    links.value = r.links.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.id - b.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
})

const unpaid = computed(() => links.value.filter((l) => l.status === 'claimed'))
const columns = [
  { title: '#', key: 'n', width: 44 },
  { title: '状态', key: 'status', width: 90 },
  { title: '金额', key: 'amount', width: 90 },
  { title: '链接', key: 'url', ellipsis: true },
  { title: '时间', key: 'time', width: 100 }
]

function copyUnpaid(): void {
  copyText(unpaid.value.map((l) => l.url).join('\n'), `已复制待付的 ${unpaid.value.length} 条`)
}
</script>

<template>
  <a-modal :open="true" width="860px" centered :footer="null" :title="`批次 ${order.code} · ${order.client ?? '-'}`" @cancel="emit('close')">
    <a-space class="gap">
      <span class="small">共 {{ links.length }} 条 · 数量 {{ order.quantity }}</span>
      <a-button size="small" :disabled="!unpaid.length" @click="copyUnpaid">复制待付的 {{ unpaid.length }} 条</a-button>
    </a-space>
    <a-table
      :columns="columns"
      :data-source="links"
      :row-key="(r: AdminLink) => r.id"
      :loading="loading"
      :pagination="false"
      :scroll="{ y: 460 }"
      size="small"
    >
      <template #bodyCell="{ column, record, index }">
        <template v-if="column.key === 'n'">{{ index + 1 }}</template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="LINK_STATUS_META[record.status as AdminLink['status']]?.color" :bordered="false">
            {{ LINK_STATUS_META[record.status as AdminLink['status']]?.text ?? record.status }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'amount'">
          <span class="small">${{ Number(record.amount_due ?? 0).toFixed(2) }}</span>
        </template>
        <template v-else-if="column.key === 'url'">
          <span :class="['small', 'mono', { void: record.status === 'superseded' }]">{{ record.url }}</span>
        </template>
        <template v-else-if="column.key === 'time'">
          <span class="small">{{ String(record.paid_at || record.claimed_at || '').slice(5, 16) }}</span>
        </template>
      </template>
    </a-table>
  </a-modal>
</template>

<style scoped>
.gap { margin-bottom: 10px; }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, Consolas, monospace; }
.void { color: var(--kal-muted); text-decoration: line-through; }
</style>
