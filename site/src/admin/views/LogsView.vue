<script setup lang="ts">
/** 操作日志：网页后台、桌面端、客户（改收款地址）的改动；内容排成「字段 值」 */
import { onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { minutes, short } from '@site/shared/format'
import { FILTER_EMPTY } from '../state'

interface Log {
  id: number
  at: string
  actor: string
  ip: string
  op: string
  detail: string
}

const OPS: Record<string, string> = {
  client_save: '保存客户',
  client_delete: '删除客户',
  client_kick: '强制下线',
  link_revoke: '收回链接',
  link_resolve: '手动定性',
  order_create: '派单',
  order_update: '修改批次',
  order_settle: '修改结算',
  settlement_add: '记录打款',
  settlement_delete: '删除打款',
  wallet_save: '客户改收款地址',
  assign_links: '分配链接',
  backfill_paid: '补记已付',
  fix_batches: '修正批次'
}
const TAG: Record<string, 'danger' | 'primary' | 'info' | undefined> = {
  wallet_save: 'danger',
  settlement_add: 'primary',
  settlement_delete: 'primary',
  order_settle: 'primary'
}
const FIELD: Record<string, string> = {
  id: 'id',
  code: '批次',
  client_id: '客户 id',
  username: '账号',
  display_name: '名称',
  order_id: '批次 id',
  quantity: '目标付款数',
  tier: '档位',
  unit_price: '每条单价',
  replace_limit: '可更换次数',
  note: '备注',
  settle_status: '结算状态',
  settled_amount: '已结金额',
  settle_note: '结算备注',
  amount: '金额',
  token: '币种',
  network: '网络',
  to: '收款地址',
  from: '原地址',
  tx: '交易哈希',
  proof: '凭证',
  status: '状态',
  enabled: '启用',
  links: '链接数',
  revoked: '收回',
  resolved: '定性',
  ids: '链接 id',
  result: '结果',
  claim_timeout_minutes: '领取时限',
  max_claim: '单次最多',
  assigned: '已分配'
}
const VALUE: Record<string, string> = {
  unsettled: '未结算',
  partial: '部分结算',
  settled: '已结清',
  prepaid: '已预付',
  open: '进行中',
  done: '已完成',
  cancelled: '已取消',
  paid: '已付款',
  expired: '失效',
  true: '是',
  false: '否',
  polygon: 'Polygon',
  ethereum: 'Ethereum',
  bsc: 'BNB Chain',
  arbitrum: 'Arbitrum',
  tron: 'Tron'
}

/** {"id":16,"settle_status":"unsettled"} → [{k:'结算状态', v:'未结算'}]；空值不显示 */
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
            : (VALUE[String(v)] ?? short(String(v), 10, 8))
      }))
  } catch {
    return [{ k: '', v: detail }]
  }
}

const rows = ref<Log[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(30)
const op = ref('')
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.admin<{ logs: Log[]; total: number }>('logs', {
      page: page.value,
      page_size: size.value,
      filter_op: op.value || undefined
    })
    rows.value = r.logs
    total.value = r.total
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))
const reload = (): void => void guard(load)
watch(op, () => {
  page.value = 1
  reload()
})
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>操作日志<span class="muted small"> {{ total }}</span></h2>
        <el-select :empty-values="FILTER_EMPTY" v-model="op" class="w-170">
          <el-option value="" label="全部操作" />
          <el-option v-for="(label, k) in OPS" :key="k" :value="k" :label="label" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
      </div>
    </template>

    <el-table v-loading="loading" :data="rows" size="small">
      <el-table-column label="时间" width="160">
        <template #default="{ row }"><span class="small">{{ row.at }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="130">
        <template #default="{ row }">
          <el-tag size="small" :type="TAG[row.op]">{{ OPS[row.op] ?? row.op }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作人" width="130" show-overflow-tooltip>
        <template #default="{ row }"><span class="small">{{ row.actor === 'desktop' ? '桌面端' : row.actor }}</span></template>
      </el-table-column>
      <el-table-column label="IP" width="130">
        <template #default="{ row }"><span class="small mono">{{ row.ip }}</span></template>
      </el-table-column>
      <el-table-column label="内容" min-width="240">
        <template #default="{ row }">
          <el-tooltip :content="row.detail" placement="top" :show-after="400">
            <span class="fields">
              <span v-for="(f, i) in fields(row.detail)" :key="i" class="field">
                <span v-if="f.k" class="muted">{{ f.k }}</span><b>{{ f.v }}</b>
              </span>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <template #empty><el-empty description="还没有操作记录" /></template>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[30, 100, 200]"
        layout="total, sizes, prev, pager, next"
        background
        @change="reload"
      />
    </div>
  </el-card>
</template>

<style scoped>
.fields { display: inline-flex; flex-wrap: wrap; gap: 3px 10px; font-size: 12px; }
.field { display: inline-flex; gap: 4px; align-items: baseline; }
.field b { font-weight: 500; }
</style>
