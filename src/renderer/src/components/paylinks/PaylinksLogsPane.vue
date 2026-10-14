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

/** 日志里常见字段的中文名 */
const FIELD: Record<string, string> = {
  id: 'id', code: '批次', client_id: '客户 id', username: '账号', display_name: '名称', order_id: '批次 id',
  quantity: '目标付款数', tier: '档位', unit_price: '每条单价', replace_limit: '可更换次数', note: '备注',
  settle_status: '结算状态', settled_amount: '已结金额', settle_note: '结算备注', amount: '金额', token: '币种',
  network: '网络', to: '收款地址', from: '原地址', tx: '交易哈希', proof: '凭证', status: '状态',
  enabled: '启用', links: '链接数', revoked: '收回', resolved: '定性', ids: '链接 id', result: '结果',
  claim_timeout_minutes: '领取时限', max_claim: '单次最多', assigned: '已分配'
}
const VALUE: Record<string, string> = {
  unsettled: '未结算', partial: '部分结算', settled: '已结算', open: '进行中', done: '已完成', cancelled: '已取消',
  paid: '已付款', expired: '失效', true: '是', false: '否',
  polygon: 'Polygon', ethereum: 'Ethereum', bsc: 'BNB Chain', arbitrum: 'Arbitrum', tron: 'Tron'
}
const short = (v: unknown): string => {
  const s = String(v)
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s
}
/** 分钟 → 7 天 / 3 小时 */
const minutes = (m: number): string => (m % 1440 === 0 ? `${m / 1440} 天` : m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`)

/** {"id":16,"settle_status":"unsettled"} → [{k:'结算状态', v:'未结算'}]；空值的字段不显示 */
function fields(detail: string): { k: string; v: string }[] {
  try {
    const o = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(o)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => ({
        k: FIELD[k] ?? k,
        v: Array.isArray(v)
          ? `${v.length} 条`
          : k === 'claim_timeout_minutes'
            ? minutes(Number(v))
            : VALUE[String(v)] ?? short(v)
      }))
  } catch {
    return [{ k: '', v: detail }]
  }
}

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
          <a-tooltip :title="record.detail" :overlay-style="{ maxWidth: '560px', wordBreak: 'break-all' }">
            <span class="fields">
              <span v-for="(f, i) in fields(record.detail)" :key="i" class="field">
                <span v-if="f.k" class="muted">{{ f.k }}</span><b>{{ f.v }}</b>
              </span>
            </span>
          </a-tooltip>
        </template>
      </template>
    </a-table>
  </a-card>
</template>

<style scoped>
.mono { font-family: ui-monospace, Consolas, monospace; }
.small { font-size: 12px; }
.muted { color: var(--kal-muted); }
.fields { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
.field { display: inline-flex; gap: 4px; align-items: baseline; }
.field b { font-weight: 500; }
</style>
