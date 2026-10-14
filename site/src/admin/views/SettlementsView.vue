<script setup lang="ts">
/** 结算：待结算客户（一键打款）+ 全部打款记录 */
import { computed, onMounted, ref } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { num, short, usd, walletFresh } from '@site/shared/format'
import { clientOptions, clients, loadClients, loadOverview, type AdminClient } from '../state'
import SettlementTable, { type Settlement } from '../components/SettlementTable.vue'
import SettleModal from '../components/SettleModal.vue'

const emit = defineEmits<{ goto: [view: 'orders', params?: Record<string, unknown>] }>()

const rows = ref<Settlement[]>([])
const total = ref(0)
const sum = ref(0)
const page = ref(1)
const size = ref(20)
const clientId = ref<number | ''>('')
const loading = ref(false)
const paying = ref<{ clientId: number | '' } | null>(null)

const owed = computed(() => clients.value.filter((c) => num(c.unsettled) > 0.004))
const settledWithoutRecord = computed(() => clients.value.reduce((s, c) => s + num(c.settled), 0) - sum.value)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.admin<{ settlements: Settlement[]; total: number; sum: number }>('settlements', {
      page: page.value,
      page_size: size.value,
      client_id: clientId.value || undefined
    })
    rows.value = r.settlements
    total.value = r.total
    sum.value = r.sum
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))
const reload = (): void => void guard(load)
async function changed(): Promise<void> {
  await guard(async () => {
    await Promise.all([load(), loadClients(), loadOverview()])
  })
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>待结算<span class="muted small"> {{ owed.length }} 个客户</span></h2>
        <span class="muted small">应付客户 − 已付客户；先预付的在客户页看余额</span>
      </div>
    </template>
    <el-table v-if="owed.length" :data="owed" size="small">
      <el-table-column label="客户" min-width="130">
        <template #default="{ row }"><b>{{ row.display_name || row.username }}</b></template>
      </el-table-column>
      <el-table-column label="付客户" width="100" align="right">
        <template #default="{ row }"><span class="num">{{ usd(row.due) }}</span></template>
      </el-table-column>
      <el-table-column label="客户实付" width="96" align="right">
        <template #default="{ row }"><span class="muted num">{{ usd(row.client_paid) }}</span></template>
      </el-table-column>
      <el-table-column label="客户赚" width="96" align="right">
        <template #default="{ row }">
          <b :class="num(row.client_profit) >= 0 ? 'ok' : 'danger'">{{ usd(row.client_profit) }}</b>
        </template>
      </el-table-column>
      <el-table-column label="已付客户" width="100" align="right">
        <template #default="{ row }"><span class="ok num">{{ usd(row.settled) }}</span></template>
      </el-table-column>
      <el-table-column label="待结算" width="100" align="right">
        <template #default="{ row }"><b class="warn num">{{ usd(row.unsettled) }}</b></template>
      </el-table-column>
      <el-table-column label="收款地址" min-width="210">
        <template #default="{ row }">
          <template v-if="row.wallet_address">
            <el-tooltip :content="row.wallet_address" placement="top">
              <span class="mono">{{ short(row.wallet_address) }}</span>
            </el-tooltip>
            <el-tag v-if="row.wallet_network !== 'polygon'" size="small" type="danger">不是 Polygon</el-tag>
            <el-tag v-else-if="walletFresh(row.wallet_updated_at)" size="small" type="danger">24h 内改过</el-tag>
          </template>
          <el-tag v-else size="small" type="warning">未设置</el-tag>
        </template>
      </el-table-column>
      <el-table-column min-width="170" align="right">
        <template #default="{ row }">
          <el-button size="small" @click="emit('goto', 'orders', { clientId: row.id, settle: 'unsettled' })">未结批次</el-button>
          <el-button size="small" type="primary" @click="paying = { clientId: row.id }">打款</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-result v-else icon="success" title="没有待结算的" sub-title="所有客户的已付款都已结清" />
  </el-card>

  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>打款记录<span class="muted small"> {{ total }} 笔 · 合计 {{ num(sum).toFixed(2) }}</span></h2>
        <el-select v-model="clientId" class="w-150" @change="(page = 1), reload()">
          <el-option v-for="o in clientOptions" :key="String(o.value)" :value="o.value" :label="o.label" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
        <el-button type="primary" :icon="Plus" @click="paying = { clientId }">记一笔打款</el-button>
      </div>
    </template>
    <el-alert
      v-if="!total && settledWithoutRecord > 0.004"
      type="info"
      show-icon
      :closable="false"
      class="hint"
      :title="`有 ${num(settledWithoutRecord).toFixed(2)} 的已结金额是在批次里手动填的，没有对应的打款记录`"
      description="以后打完款点「记一笔打款」，附上交易哈希或截图，这里才查得到凭证。"
    />
    <div v-loading="loading">
      <SettlementTable :rows="rows" @changed="changed" @open-order="(id) => emit('goto', 'orders', { orderId: id })" />
    </div>
    <div v-if="total > size" class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
        @change="reload"
      />
    </div>
  </el-card>

  <SettleModal v-if="paying" :client-id="paying.clientId" @close="paying = null" @saved="changed" />
</template>

<style scoped>
.hint { margin-bottom: 10px; }
</style>
