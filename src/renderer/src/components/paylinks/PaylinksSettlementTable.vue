<script setup lang="ts">
/** 打款记录表：打款时间 / 客户 / 批次 / 金额 / 网络与地址 / 交易（区块浏览器）/ 凭证 / 备注 / 删除 */
import { message } from 'ant-design-vue'
import { DeleteOutlined, FileImageOutlined } from '@ant-design/icons-vue'
import { confirmDanger } from '@/utils/ui'
import { openProof, paylinksAdmin, type AdminSettlement } from '@/utils/paylinksAdmin'

const props = withDefaults(defineProps<{ rows: AdminSettlement[]; withOrder?: boolean; withClient?: boolean }>(), { withOrder: true, withClient: true })
const emit = defineEmits<{ changed: []; 'open-order': [id: number] }>()

const shortOf = (s: string, head = 8, tail = 6): string => (s && s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s || '-')

const columns = [
  { title: '打款时间', key: 'time', width: 120 },
  ...(props.withClient ? [{ title: '客户', key: 'client', width: 110, ellipsis: true }] : []),
  ...(props.withOrder ? [{ title: '批次', key: 'order', width: 110 }] : []),
  { title: '金额', key: 'amount', width: 120 },
  { title: '网络 / 地址', key: 'to', width: 170 },
  { title: '交易', key: 'tx', width: 150 },
  { title: '凭证', key: 'proof', width: 64 },
  { title: '备注', key: 'note', ellipsis: true },
  { title: '', key: 'act', width: 48 }
]

function openTx(url: string): void {
  void window.api.openExternal(url)
}

async function viewProof(s: AdminSettlement): Promise<void> {
  try {
    await openProof(s.id)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

function remove(s: AdminSettlement): void {
  confirmDanger({
    title: '删除打款记录',
    content: `${Number(s.amount).toFixed(2)} ${s.token}：删除后批次的已结金额会扣回，凭证文件一并删除。`,
    okText: '删除',
    onOk: async () => {
      await paylinksAdmin.deleteSettlement(s.id)
      message.success('已删除')
      emit('changed')
    }
  })
}
</script>

<template>
  <a-table :columns="columns" :data-source="rows" :row-key="(r: AdminSettlement) => r.id" :pagination="false" size="small"
    :locale="{ emptyText: '还没有打款记录，打完款点「记一笔打款」，附上交易哈希或截图' }">
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'time'">
        <div class="small">{{ String(record.paid_at).slice(5, 16) }}</div>
        <div class="muted small">{{ record.created_by === 'desktop' ? '桌面端' : record.created_by }}</div>
      </template>
      <template v-else-if="column.key === 'client'">{{ record.client ?? '-' }}</template>
      <template v-else-if="column.key === 'order'">
        <a v-if="record.order_id" @click="emit('open-order', record.order_id)">{{ record.code }}</a>
        <span v-else class="muted small">未挂批次</span>
      </template>
      <template v-else-if="column.key === 'amount'"><b>{{ Number(record.amount).toFixed(2) }}</b> <span class="small">{{ record.token }}</span></template>
      <template v-else-if="column.key === 'to'">
        <div class="small muted">{{ record.network_name }}</div>
        <a-tooltip :title="record.to_address"><span class="mono">{{ shortOf(record.to_address) }}</span></a-tooltip>
      </template>
      <template v-else-if="column.key === 'tx'">
        <a v-if="record.tx_url" class="mono" @click="openTx(record.tx_url)">{{ shortOf(record.tx_hash) }} ↗</a>
        <span v-else class="muted">-</span>
      </template>
      <template v-else-if="column.key === 'proof'">
        <a-tooltip v-if="record.has_proof" title="用系统默认程序打开">
          <a-button type="link" size="small" @click="viewProof(record)"><template #icon><FileImageOutlined /></template></a-button>
        </a-tooltip>
        <span v-else class="muted">-</span>
      </template>
      <template v-else-if="column.key === 'note'"><span class="small">{{ record.note }}</span></template>
      <template v-else-if="column.key === 'act'">
        <a-button type="text" size="small" danger @click="remove(record)"><template #icon><DeleteOutlined /></template></a-button>
      </template>
    </template>
  </a-table>
</template>

<style scoped>
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
</style>
