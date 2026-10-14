<script setup lang="ts">
/** 打款记录表（后台）：可删除，凭证新窗口打开 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { dt, num, short } from '@site/shared/format'

export interface Settlement {
  id: number
  client_id: number
  client: string | null
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
  created_by: string
  paid_at: string
}

const props = withDefaults(defineProps<{ rows: Settlement[]; withOrder?: boolean; withClient?: boolean }>(), {
  withOrder: true,
  withClient: true
})
const emit = defineEmits<{ changed: []; 'open-order': [id: number] }>()

async function remove(s: Settlement): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `${num(s.amount).toFixed(2)} ${s.token}：删除后批次的已结金额会扣回，凭证文件一并删除。`,
      '删除打款记录',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await guard(async () => {
    await api.admin('settlement_delete', { id: s.id })
    ElMessage.success('已删除')
    emit('changed')
  })
}
</script>

<template>
  <el-table :data="props.rows" size="small">
    <el-table-column label="打款时间" width="128">
      <template #default="{ row }">
        <div class="small">{{ dt(row.paid_at) }}</div>
        <div class="muted small">{{ row.created_by === 'desktop' ? '桌面端' : row.created_by }}</div>
      </template>
    </el-table-column>
    <el-table-column v-if="props.withClient" label="客户" width="110" show-overflow-tooltip>
      <template #default="{ row }">{{ row.client ?? '-' }}</template>
    </el-table-column>
    <el-table-column v-if="props.withOrder" label="批次" width="126">
      <template #default="{ row }">
        <el-link v-if="row.order_id" type="primary" :underline="false" @click="emit('open-order', row.order_id)">
          {{ row.code }}
        </el-link>
        <span v-else class="muted small">未挂批次</span>
      </template>
    </el-table-column>
    <el-table-column label="金额" width="116" align="right">
      <template #default="{ row }">
        <b class="num">{{ num(row.amount).toFixed(2) }}</b>
        <span class="muted small"> {{ row.token }}</span>
      </template>
    </el-table-column>
    <el-table-column label="网络 / 地址" width="168">
      <template #default="{ row }">
        <div class="muted small">{{ row.network_name }}</div>
        <el-tooltip :content="row.to_address || '-'" placement="top">
          <span class="mono">{{ short(row.to_address) }}</span>
        </el-tooltip>
      </template>
    </el-table-column>
    <el-table-column label="交易" width="150">
      <template #default="{ row }">
        <el-link v-if="row.tx_url" type="primary" :href="row.tx_url" target="_blank" rel="noopener noreferrer" class="mono">
          {{ short(row.tx_hash) }} ↗
        </el-link>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column label="凭证" width="78">
      <template #default="{ row }">
        <el-link
          v-if="row.has_proof"
          type="primary"
          :href="`api.php?action=proof&id=${row.id}`"
          target="_blank"
          rel="noopener"
        >
          查看
        </el-link>
        <span v-else class="muted">-</span>
      </template>
    </el-table-column>
    <el-table-column label="备注" min-width="110" show-overflow-tooltip>
      <template #default="{ row }"><span class="small">{{ row.note }}</span></template>
    </el-table-column>
    <el-table-column width="56" align="right">
      <template #default="{ row }">
        <el-button text type="danger" size="small" :icon="Delete" @click="remove(row)" />
      </template>
    </el-table-column>
    <template #empty>
      <el-empty description="还没有打款记录，打完款点「记一笔打款」，附上交易哈希或截图" />
    </template>
  </el-table>
</template>
