<script setup lang="ts">
/** 结算记录：管理员给我打的每一笔，带交易哈希与凭证 */
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { num, usd } from '@site/shared/format'
import { tt } from '../i18n'
import { loadMe, me } from '../state'
import SettlementTable, { type Settlement } from '../components/SettlementTable.vue'

const rows = ref<Settlement[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const stats = computed(() => me.value?.stats)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [r] = await Promise.all([
      api.get<{ settlements: Settlement[]; total: number }>('my_settlements', { page: page.value, page_size: size.value }),
      loadMe()
    ])
    rows.value = r.settlements
    total.value = r.total
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))
const reload = (): void => void guard(load)
</script>

<template>
  <div v-if="stats" class="stats">
    <el-card shadow="never">
      <div class="stat-label">{{ tt('stat_due') }}</div>
      <div class="stat-value">{{ usd(stats.due) }}</div>
      <div class="stat-sub">{{ tt('stat_due_sub') }}</div>
    </el-card>
    <el-card shadow="never">
      <div class="stat-label">{{ tt('stat_settled') }}</div>
      <div class="stat-value ok">{{ usd(stats.settled) }}</div>
      <div class="stat-sub">{{ tt('settle_records_n', { n: total }) }}</div>
    </el-card>
    <el-card shadow="never">
      <div class="stat-label">
        {{ num(stats.prepaid) > 0.004 ? tt('stat_prepaid') : tt('stat_unsettled') }}
      </div>
      <div class="stat-value" :class="num(stats.prepaid) > 0.004 ? 'primary' : 'warn'">
        {{ usd(num(stats.prepaid) > 0.004 ? stats.prepaid : stats.unsettled) }}
      </div>
      <div class="stat-sub">{{ tt('settle_rule') }}</div>
    </el-card>
    <el-card shadow="never">
      <div class="stat-label">{{ tt('stat_profit') }}</div>
      <div class="stat-value ok">{{ usd(stats.profit) }}</div>
      <div class="stat-sub">{{ tt('stat_paid_out_n', { n: usd(stats.paid_usd) }) }}</div>
    </el-card>
  </div>

  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>{{ tt('settlements_title') }}</h2>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
      </div>
    </template>
    <div v-loading="loading">
      <SettlementTable :rows="rows" />
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
</template>
