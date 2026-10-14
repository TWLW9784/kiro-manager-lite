<script setup lang="ts">
/** 打款记录表：时间 / 批次 / 金额 / 网络与地址 / 交易 / 凭证 / 备注 */
import { computed } from 'vue'
import { dt, num, short } from '@site/shared/format'
import { tt } from '../i18n'

export interface Settlement {
  id: number
  order_id: number | null
  code: string | null
  amount: string
  token: string
  network: string
  network_name: string
  to_address: string
  tx_hash: string
  tx_url: string | null
  has_proof: boolean
  note: string
  paid_at: string
}

const props = withDefaults(defineProps<{ rows: Settlement[]; withOrder?: boolean }>(), { withOrder: true })
const emit = defineEmits<{ 'open-order': [id: number] }>()
const empty = computed(() => `${tt.value('no_settlements')}｜${tt.value('no_settlements_tip')}`)
</script>

<template>
  <el-table :data="props.rows" size="small">
    <el-table-column :label="tt('col_time')" width="120">
      <template #default="{ row }">{{ dt(row.paid_at) }}</template>
    </el-table-column>
    <el-table-column v-if="props.withOrder" :label="tt('col_batch')" width="130">
      <template #default="{ row }">
        <el-link v-if="row.order_id" type="primary" :underline="false" @click="emit('open-order', row.order_id)">
          {{ row.code }}
        </el-link>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column :label="tt('col_amount')" width="120" align="right">
      <template #default="{ row }">
        <b class="num">{{ num(row.amount).toFixed(2) }}</b>
        <span class="muted small"> {{ row.token }}</span>
      </template>
    </el-table-column>
    <el-table-column :label="tt('col_network')" width="110">
      <template #default="{ row }">{{ row.network_name }}</template>
    </el-table-column>
    <el-table-column :label="tt('col_to')" width="150">
      <template #default="{ row }">
        <el-tooltip :content="row.to_address" placement="top">
          <span class="mono">{{ short(row.to_address) }}</span>
        </el-tooltip>
      </template>
    </el-table-column>
    <el-table-column :label="tt('col_tx')" width="160">
      <template #default="{ row }">
        <el-link
          v-if="row.tx_url"
          type="primary"
          :href="row.tx_url"
          target="_blank"
          rel="noopener noreferrer"
          class="mono"
        >
          {{ short(row.tx_hash) }} ↗
        </el-link>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column :label="tt('col_proof')" width="90">
      <template #default="{ row }">
        <el-link
          v-if="row.has_proof"
          type="primary"
          :href="`api.php?action=proof&id=${row.id}`"
          target="_blank"
          rel="noopener"
        >
          {{ tt('view_proof') }}
        </el-link>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column :label="tt('col_note')" min-width="120">
      <template #default="{ row }"><span class="small">{{ row.note }}</span></template>
    </el-table-column>
    <template #empty><el-empty :description="empty" /></template>
  </el-table>
</template>
