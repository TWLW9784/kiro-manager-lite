<script setup lang="ts">
/** 链接明细：按客户 / 状态 / 档位 / 日期筛选，可批量收回、手动定性 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import PaylinkUrl from '@site/shared/PaylinkUrl.vue'
import { api, guard } from '@site/shared/api'
import { LINK_STATUS, cny, copyText, dt, num, usd } from '@site/shared/format'
import { clientOptions } from '../state'

const props = defineProps<{ clientId?: number; status?: string }>()

interface Link {
  id: number
  url: string
  tier: string
  amount_due: string | null
  amount_cny: string | null
  status: string
  client: string | null
  claimed_at: string | null
  paid_at: string | null
  extracted_at: string
  refresh_reason: string | null
}
const REASON: Record<string, string> = {
  timeout: '超时未付',
  released: '客户退回',
  expired: 'Stripe 过期',
  revoked: '管理收回',
  replaced: '客户更换'
}
const TIERS = ['pro', 'pro+', 'promax', 'power']

const rows = ref<Link[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(50)
const clientId = ref<number | ''>(props.clientId ?? '')
const status = ref(props.status ?? '')
const tier = ref('')
const range = ref<[string, string] | null>(null)
const q = ref('')
const loading = ref(false)
const selected = ref<Link[]>([])

const filtered = computed(() => !!clientId.value || !!status.value || !!tier.value || !!range.value || !!q.value.trim())

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.admin<{ links: Link[]; total: number }>('links', {
      page: page.value,
      page_size: size.value,
      client_id: clientId.value || undefined,
      statuses: status.value ? [status.value] : undefined,
      include_void: status.value === 'superseded' ? 1 : undefined,
      tier: tier.value || undefined,
      from: range.value?.[0],
      to: range.value?.[1],
      q: q.value.trim() || undefined
    })
    rows.value = r.links
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
watch([clientId, status, tier, range], refilter)
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(refilter, 400)
})
function reset(): void {
  clientId.value = ''
  status.value = ''
  tier.value = ''
  range.value = null
  q.value = ''
}

const revocable = computed(() => selected.value.filter((l) => ['claimed', 'checking', 'available'].includes(l.status)))

async function revoke(): Promise<void> {
  if (!revocable.value.length) return void ElMessage.info('先勾选要收回的链接')
  try {
    await ElMessageBox.confirm(
      `收回 ${revocable.value.length} 条？旧链接作废，客户那边会消失；桌面端下一轮会换新上架。已付款的不受影响。`,
      '收回链接',
      { type: 'warning', confirmButtonText: '收回', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await guard(async () => {
    const r = await api.admin<{ revoked: number }>('link_revoke', { ids: revocable.value.map((l) => l.id) })
    ElMessage.success(`已收回 ${r.revoked} 条`)
    reload()
  })
}

async function resolve(link: Link, result: 'paid' | 'expired'): Promise<void> {
  try {
    await ElMessageBox.confirm(
      result === 'paid' ? '记成已付款，计入客户结算。请先确认这个号真的付了。' : '记成失效，进入待换新。',
      result === 'paid' ? '确认已付' : '确认失效',
      { type: result === 'paid' ? 'info' : 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await guard(async () => {
    await api.admin('link_resolve', { id: link.id, result })
    ElMessage.success('已定性')
    reload()
  })
}

async function copyPage(): Promise<void> {
  if (!rows.value.length) return void ElMessage.info('本页没有链接')
  await copyText(rows.value.map((l) => l.url).join('\n'))
  ElMessage.success(`已复制 ${rows.value.length} 条`)
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>链接明细<span class="muted small"> {{ total }}</span></h2>
        <el-button size="small" @click="copyPage">复制本页</el-button>
        <el-button size="small" type="danger" plain :disabled="!revocable.length" @click="revoke">
          收回所选（{{ revocable.length }}）
        </el-button>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
      </div>
    </template>

    <div class="toolbar">
      <el-input v-model="q" placeholder="搜 cs_live_… / 批次号" clearable class="w-200" />
      <el-select v-model="clientId" class="w-150">
        <el-option v-for="o in clientOptions" :key="String(o.value)" :value="o.value" :label="o.label" />
      </el-select>
      <el-select v-model="status" class="w-150">
        <el-option value="" label="全部状态" />
        <el-option v-for="(m, k) in LINK_STATUS" :key="k" :value="k" :label="m.text" />
      </el-select>
      <el-select v-model="tier" class="w-130">
        <el-option value="" label="全部档位" />
        <el-option v-for="t in TIERS" :key="t" :value="t" :label="t" />
      </el-select>
      <el-date-picker
        v-model="range"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="付款日期从"
        end-placeholder="到"
        range-separator="→"
      />
      <el-button v-if="filtered" @click="reset">重置筛选</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" size="small" @selection-change="(v: Link[]) => (selected = v)">
      <el-table-column
        type="selection"
        width="44"
        :selectable="(r: Link) => ['claimed', 'checking', 'available'].includes(r.status)"
      />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="LINK_STATUS[row.status]?.type || undefined">
            {{ LINK_STATUS[row.status]?.text ?? row.status }}
          </el-tag>
          <div v-if="row.refresh_reason" class="muted small">{{ REASON[row.refresh_reason] ?? row.refresh_reason }}</div>
        </template>
      </el-table-column>
      <el-table-column label="档位" width="80">
        <template #default="{ row }">{{ row.tier }}</template>
      </el-table-column>
      <el-table-column label="金额" width="104" align="right">
        <template #default="{ row }">
          <div class="num">{{ usd(row.amount_due) }}</div>
          <div v-if="num(row.amount_cny)" class="muted small">{{ cny(row.amount_cny) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="客户" min-width="100" show-overflow-tooltip>
        <template #default="{ row }">{{ row.client ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="链接" min-width="190">
        <template #default="{ row }">
          <PaylinkUrl :url="row.url" :void="row.status === 'superseded'" tip="点击复制整条链接" />
        </template>
      </el-table-column>
      <el-table-column label="时间" min-width="120">
        <template #default="{ row }">
          <span class="small muted">
            {{ row.paid_at ? `付 ${dt(row.paid_at)}` : row.claimed_at ? `领 ${dt(row.claimed_at)}` : `提 ${dt(row.extracted_at)}` }}
          </span>
        </template>
      </el-table-column>
      <el-table-column min-width="150" align="right">
        <template #default="{ row }">
          <template v-if="row.status === 'checking'">
            <el-button size="small" @click="resolve(row, 'paid')">已付</el-button>
            <el-button size="small" type="danger" plain @click="resolve(row, 'expired')">失效</el-button>
          </template>
        </template>
      </el-table-column>
      <template #empty><el-empty description="没有符合条件的链接" /></template>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next"
        background
        @change="reload"
      />
    </div>
  </el-card>
</template>

<style scoped>
</style>
