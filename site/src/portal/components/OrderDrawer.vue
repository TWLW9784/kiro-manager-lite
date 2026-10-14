<script setup lang="ts">
/** 批次详情：进度、结算、全部链接（作废的不给链接）、打款记录 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PaylinkUrl from '@site/shared/PaylinkUrl.vue'
import { api, guard } from '@site/shared/api'
import { LINK_STATUS, ORDER_STATUS, SETTLE_STATUS, cny, copyText, dt, num, usd } from '@site/shared/format'
import { t, tt } from '../i18n'
import { claimRule, loadMe, me } from '../state'
import SettlementTable from './SettlementTable.vue'

const props = defineProps<{ orderId: number }>()
const emit = defineEmits<{ close: []; changed: [] }>()

interface OrderDetail {
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
  paid_usd: string
  paid_cny: string
  remaining: number
}

const loading = ref(true)
const order = ref<OrderDetail | null>(null)
const links = ref<{ id: number; url: string | null; status: string; amount_due: string | null; amount_cny: string | null; claimed_at: string | null; paid_at: string | null }[]>([])
const settlements = ref<any[]>([])
const filter = ref('all')
const claimN = ref(1)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.get<{ order: OrderDetail; links: typeof links.value; settlements: any[] }>('my_order', { id: props.orderId })
    order.value = r.order
    links.value = r.links
    settlements.value = r.settlements
    claimN.value = Math.max(1, Math.min(num(r.order.remaining), me.value?.max_claim ?? 50))
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))

const count = (s: string): number => links.value.filter((l) => l.status === s).length
const shown = computed(() => (filter.value === 'all' ? links.value : links.value.filter((l) => l.status === filter.value)))
const unpaid = computed(() => links.value.filter((l) => l.status === 'claimed'))

async function copyUnpaid(): Promise<void> {
  await copyText(unpaid.value.map((l) => l.url).join('\n'))
  ElMessage.success(t('copied', { n: unpaid.value.length }))
}

async function claim(): Promise<void> {
  await guard(async () => {
    const r = await api.post<{ claimed: number; short: number }>('claim', { order_id: props.orderId, count: claimN.value })
    ElMessage({
      type: r.claimed ? 'success' : 'info',
      message: r.claimed ? t('claimed_ok', { n: r.claimed }) : t('waiting_stock')
    })
    await Promise.all([loadMe(), load()])
    emit('changed')
  })
}

async function replace(id: number): Promise<void> {
  try {
    await ElMessageBox.confirm(t('replace_confirm'), t('replace'), { confirmButtonText: t('replace'), cancelButtonText: t('cancel') })
  } catch {
    return
  }
  await guard(async () => {
    const r = await api.post<{ new_id: number | null }>('replace', { id })
    ElMessage.success(r.new_id ? t('replaced_ok') : t('replaced_wait'))
    await load()
    emit('changed')
  })
}
</script>

<template>
  <el-drawer :model-value="true" size="760px" :title="order?.code ?? ''" @close="emit('close')">
    <template v-if="order" #header>
      <div class="drawer-title">
        <b>{{ order.code }}</b>
        <el-tag size="small" :type="ORDER_STATUS[order.status]?.type || undefined">{{ ORDER_STATUS[order.status]?.text }}</el-tag>
        <el-tag v-if="order.source === 'offline'" size="small">{{ tt('source_offline') }}</el-tag>
      </div>
    </template>

    <div v-loading="loading" class="body">
      <template v-if="order">
        <div class="stats">
          <el-card shadow="never">
            <div class="stat-label">{{ tt('stat_paid') }}</div>
            <div class="stat-value ok">{{ num(order.paid) }} / {{ order.quantity }}</div>
            <el-progress :percentage="Math.min(100, Math.round((num(order.paid) / Math.max(1, order.quantity)) * 100))" :show-text="false" />
          </el-card>
          <el-card shadow="never">
            <div class="stat-label">{{ tt('stat_pending') }}</div>
            <div class="stat-value warn">{{ num(order.holding) }}</div>
            <div class="stat-sub">{{ num(order.void) ? tt('void_n', { n: num(order.void) }) : '' }}</div>
          </el-card>
          <el-card shadow="never">
            <div class="stat-label">{{ tt('stat_due') }}</div>
            <div class="stat-value">{{ usd(order.due_amount) }}</div>
            <div class="stat-sub">
              {{ order.unit_price !== null ? tt('settle_by_count', { n: num(order.paid), p: usd(order.unit_price) }) : tt('settle_by_amount') }}
            </div>
          </el-card>
          <el-card shadow="never">
            <div class="stat-label">{{ tt('stat_profit') }}</div>
            <div class="stat-value ok">{{ order.unit_price !== null ? usd(order.profit) : '-' }}</div>
            <div class="stat-sub">{{ tt('my_paid_n', { n: usd(order.paid_usd) }) }}</div>
          </el-card>
        </div>

        <el-descriptions :column="2" border size="small">
          <el-descriptions-item :label="tt('col_tier')">{{ order.tier }}</el-descriptions-item>
          <el-descriptions-item :label="tt('col_settle')">
            <el-tag size="small" :type="SETTLE_STATUS[order.settle_status]?.type || undefined">
              {{ SETTLE_STATUS[order.settle_status]?.text }}
            </el-tag>
            <span v-if="num(order.settled_amount)" class="muted small"> {{ usd(order.settled_amount) }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="tt('col_target')">
            {{ tt('target_progress', { qty: order.quantity, paid: num(order.paid), holding: num(order.holding), remaining: num(order.remaining) }) }}
          </el-descriptions-item>
          <el-descriptions-item :label="tt('col_source')">
            {{ order.source === 'offline' ? tt('source_offline_tip') : tt('source_site_tip') }}
          </el-descriptions-item>
          <el-descriptions-item :label="tt('col_created')">{{ order.created_at }}</el-descriptions-item>
          <el-descriptions-item v-if="order.note" :label="tt('col_note')">{{ order.note }}</el-descriptions-item>
        </el-descriptions>

        <el-alert v-if="order.status === 'open' && num(order.remaining) > 0" type="info" :closable="false" show-icon>
          <template #title>{{ tt('can_claim_n', { n: num(order.remaining) }) }}</template>
          <div class="claim-box">
            <span class="muted small grow">{{ claimRule }}</span>
            <el-input-number v-model="claimN" :min="1" :max="Math.min(num(order.remaining), me?.max_claim ?? 50)" size="small" />
            <el-button size="small" type="primary" @click="claim">{{ tt('claim') }}</el-button>
          </div>
        </el-alert>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <h2>{{ tt('links_title') }}</h2>
              <el-button size="small" :disabled="!unpaid.length" @click="copyUnpaid">
                {{ tt('copy_unpaid', { n: unpaid.length }) }}
              </el-button>
            </div>
          </template>
          <el-radio-group v-model="filter" size="small" class="seg">
            <el-radio-button value="all">{{ tt('all') }} {{ links.length }}</el-radio-button>
            <el-radio-button value="claimed">{{ tt('link_claimed') }} {{ count('claimed') }}</el-radio-button>
            <el-radio-button value="paid">{{ tt('link_paid') }} {{ count('paid') }}</el-radio-button>
            <el-radio-button value="void">{{ tt('link_void') }} {{ count('void') }}</el-radio-button>
          </el-radio-group>
          <el-table :data="shown" size="small">
            <el-table-column type="index" width="44" />
            <el-table-column :label="tt('col_status')" width="92">
              <template #default="{ row }">
                <el-tag size="small" :type="LINK_STATUS[row.status]?.type || undefined">{{ tt(`link_${row.status}`) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="tt('col_amount')" width="110" align="right">
              <template #default="{ row }">
                <div class="num">{{ usd(row.amount_due) }}</div>
                <div v-if="num(row.amount_cny)" class="muted small">{{ cny(row.amount_cny) }}</div>
              </template>
            </el-table-column>
            <el-table-column :label="tt('col_link')" min-width="180">
              <template #default="{ row }">
                <PaylinkUrl v-if="row.url" :url="row.url" :tip="tt('click_copy')" :copied="tt('copied', { n: 1 })" />
                <span v-else class="muted small">{{ tt('void_hint') }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="tt('col_time')" width="110">
              <template #default="{ row }">
                <span class="small muted">{{ dt(row.paid_at || row.claimed_at) }}</span>
              </template>
            </el-table-column>
            <el-table-column width="86" align="right">
              <template #default="{ row }">
                <el-button v-if="row.status === 'claimed' && order!.source !== 'offline'" size="small" text @click="replace(row.id)">
                  {{ tt('replace') }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <h2>{{ tt('settlements_title') }}</h2>
              <span class="muted small">{{ tt('settle_rule') }}</span>
            </div>
          </template>
          <SettlementTable :rows="settlements" :with-order="false" />
        </el-card>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.body { display: flex; flex-direction: column; gap: 14px; }
.drawer-title { display: flex; align-items: center; gap: 8px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.seg { margin-bottom: 10px; }
.claim-box { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
</style>
