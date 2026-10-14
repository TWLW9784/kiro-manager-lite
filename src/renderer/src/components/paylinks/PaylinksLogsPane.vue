<script setup lang="ts">
/** 网站管理日志：网页后台、桌面端、客户（改收款地址）的操作，分页，可按操作类型筛 */
import { ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { paylinksAdmin, type AdminLog } from '@/utils/paylinksAdmin'

const props = defineProps<{ active?: boolean }>()

const OPS: Record<string, string> = {
  client_save: '保存客户', client_delete: '删除客户', client_kick: '强制下线', link_revoke: '收回链接', link_resolve: '手动定性',
  order_create: '派单', order_update: '修改批次', order_settle: '修改结算', settlement_add: '记录打款', settlement_delete: '删除打款',
  wallet_save: '客户改收款地址', assign_links: '分配链接', backfill_paid: '补记已付', fix_batches: '修正批次'
}
const COLORS: Record<string, string> = { wallet_save: 'red', settlement_add: 'blue', settlement_delete: 'blue', order_settle: 'blue' }

const rows = ref<AdminLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(30)
const op = ref<string | undefined>(undefined)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await paylinksAdmin.logs({ filter_op: op.value, page: page.value, page_size: pageSize.value })
    rows.value = r.logs
    total.value = r.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}
watch(op, () => { page.value = 1; void load() })
watch([page, pageSize], () => void load())
watch(() => props.active, (on) => on && load(), { immediate: true })

const columns = [
  { title: '时间', key: 'at', width: 150 },
  { title: '操作', key: 'op', width: 120 },
  { title: '操作人', key: 'actor', width: 120, ellipsis: true },
  { title: 'IP', key: 'ip', width: 120 },
  { title: '内容', key: 'detail', ellipsis: true }
]
</script>

<template>
  <a-card size="small" :title="`操作日志（${total}）`">
    <template #extra>
      <a-space>
        <a-select v-model:value="op" allow-clear placeholder="全部操作" size="small" style="width: 140px"
          :options="Object.entries(OPS).map(([value, label]) => ({ value, label }))" />
        <a-button size="small" :loading="loading" @click="load"><template #icon><ReloadOutlined /></template></a-button>
      </a-space>
    </template>
    <a-table :columns="columns" :data-source="rows" :row-key="(r: AdminLog) => r.id" :loading="loading" size="small"
      :pagination="{ current: page, pageSize, total, size: 'small', showSizeChanger: true, pageSizeOptions: ['30', '100', '200'],
        onChange: (p: number, s: number) => ((page = p), (pageSize = s)) }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'at'"><span class="small">{{ record.at }}</span></template>
        <template v-else-if="column.key === 'op'"><a-tag :color="COLORS[record.op]" :bordered="false">{{ OPS[record.op] ?? record.op }}</a-tag></template>
        <template v-else-if="column.key === 'actor'"><span class="small">{{ record.actor === 'desktop' ? '桌面端' : record.actor }}</span></template>
        <template v-else-if="column.key === 'ip'"><span class="small mono">{{ record.ip }}</span></template>
        <template v-else-if="column.key === 'detail'">
          <a-tooltip :title="record.detail" :overlay-style="{ maxWidth: '560px', wordBreak: 'break-all' }"><span class="small mono">{{ record.detail }}</span></a-tooltip>
        </template>
      </template>
    </a-table>
  </a-card>
</template>

<style scoped>
.mono { font-family: ui-monospace, Consolas, monospace; }
.small { font-size: 12px; }
</style>
