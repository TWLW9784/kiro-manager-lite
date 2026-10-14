<script setup lang="ts">
/** 已付款：日期快捷 + 自定义范围，可导出对账 CSV */
import { onMounted, ref } from 'vue'
import { Download, Refresh } from '@element-plus/icons-vue'
import PaylinkUrl from '@site/shared/PaylinkUrl.vue'
import { api, guard } from '@site/shared/api'
import { cny, dt, num, usd } from '@site/shared/format'
import { lang, tt } from '../i18n'

interface PaidLink {
  id: number
  url: string
  tier: string
  amount_due: string | null
  amount_cny: string | null
  paid_at: string
  order_id: number | null
  code: string | null
}

const rows = ref<PaidLink[]>([])
const total = ref(0)
const sumUsd = ref(0)
const sumCny = ref(0)
const page = ref(1)
const size = ref(20)
const range = ref<[string, string] | null>(null)
const quick = ref('')
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.get<{ links: PaidLink[]; total: number; sum_usd: number; sum_cny: number }>('my_paid', {
      page: page.value,
      page_size: size.value,
      from: range.value?.[0],
      to: range.value?.[1]
    })
    rows.value = r.links
    total.value = r.total
    sumUsd.value = r.sum_usd
    sumCny.value = r.sum_cny
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))
const reload = (): void => void guard(load)

const day = (offset: number): string =>
  new Date(Date.now() + offset * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10)

function pickQuick(v: string): void {
  quick.value = v
  range.value = v === 'today' ? [day(0), day(0)] : v === '7d' ? [day(-6), day(0)] : v === '30d' ? [day(-29), day(0)] : null
  page.value = 1
  reload()
}
function onRange(): void {
  quick.value = ''
  page.value = 1
  reload()
}
const csvUrl = (): string =>
  `api.php?action=export_paid&from=${encodeURIComponent(range.value?.[0] ?? '')}&to=${encodeURIComponent(range.value?.[1] ?? '')}&lang=${lang.value}`
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>{{ tt('nav_paid') }}</h2>
        <span class="muted small">{{ tt('paid_sum', { n: total, usd: usd(sumUsd), cny: cny(sumCny) }) }}</span>
        <el-button :icon="Download" tag="a" :href="csvUrl()">{{ tt('export_csv') }}</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
      </div>
    </template>

    <div class="toolbar">
      <el-radio-group v-model="quick" size="small" @change="pickQuick">
        <el-radio-button value="">{{ tt('range_all') }}</el-radio-button>
        <el-radio-button value="today">{{ tt('range_today') }}</el-radio-button>
        <el-radio-button value="7d">{{ tt('range_7d') }}</el-radio-button>
        <el-radio-button value="30d">{{ tt('range_30d') }}</el-radio-button>
      </el-radio-group>
      <el-date-picker
        v-model="range"
        type="daterange"
        value-format="YYYY-MM-DD"
        :start-placeholder="tt('from')"
        :end-placeholder="tt('to')"
        :range-separator="'→'"
        @change="onRange"
      />
    </div>

    <el-table v-loading="loading" :data="rows">
      <el-table-column :label="tt('col_paid_at')" width="140">
        <template #default="{ row }">{{ dt(row.paid_at) }}</template>
      </el-table-column>
      <el-table-column :label="tt('col_batch')" width="150">
        <template #default="{ row }">
          {{ row.code ?? '-' }}
          <div class="muted small">{{ row.tier }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_amount')" width="130" align="right">
        <template #default="{ row }">
          <div class="num">{{ usd(row.amount_due) }}</div>
          <div v-if="num(row.amount_cny)" class="muted small">{{ cny(row.amount_cny) }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_link')" min-width="200">
        <template #default="{ row }">
          <PaylinkUrl :url="row.url" :tip="tt('click_copy')" :copied="tt('copied', { n: 1 })" />
        </template>
      </el-table-column>
      <template #empty><el-empty :description="tt('no_paid')" /></template>
    </el-table>

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
