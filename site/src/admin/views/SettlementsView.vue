<script setup lang="ts">
/**
 * 打款记录：每一笔付给客户的钱。
 * 「欠谁多少」在总览的「要处理的事」和客户页里看，这里只是流水，方便查账。
 */
import { onMounted, ref } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { num } from '@site/shared/format'
import { FILTER_EMPTY, clientOptions, loadClients, loadOverview } from '../state'
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
        <h2>打款记录<span class="muted small"> {{ total }} 笔 · 合计 {{ num(sum).toFixed(2) }}</span></h2>
        <el-select :empty-values="FILTER_EMPTY" v-model="clientId" class="w-150" @change="(page = 1), reload()">
          <el-option v-for="o in clientOptions" :key="String(o.value)" :value="o.value" :label="o.label" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
        <el-button type="primary" :icon="Plus" @click="paying = { clientId }">记一笔打款</el-button>
      </div>
    </template>
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
