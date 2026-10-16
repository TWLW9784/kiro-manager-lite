<script setup lang="ts">
/** 打款记录表（后台）：可删除，凭证新窗口打开 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { dt, num, short, validTxHash } from '@site/shared/format'
import { dialogTop, dialogWidth, useViewport } from '@site/shared/responsive'

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

// ---- 修改 ----
const { width: vw } = useViewport()
const boxWidth = computed(() => dialogWidth(vw.value, 480))
const boxTop = computed(() => dialogTop(vw.value))
const editOpen = ref(false)
const saving = ref(false)
const edit = ref({ id: 0, amount: 0 as number | undefined, tx_hash: '', paid_at: '', note: '' })

function startEdit(s: Settlement): void {
  // 打款时间按北京时间存、也按北京时间改（和「记一笔打款」一致），只取到分钟
  edit.value = { id: s.id, amount: num(s.amount), tx_hash: s.tx_hash, paid_at: s.paid_at.slice(0, 16), note: s.note }
  editOpen.value = true
}

async function saveEdit(): Promise<void> {
  const e = edit.value
  if (!(num(e.amount) > 0)) return void ElMessage.error('金额要大于 0')
  if (e.tx_hash.trim() && !validTxHash(e.tx_hash.trim())) return void ElMessage.error('交易哈希格式不对')
  saving.value = true
  try {
    await guard(async () => {
      await api.admin('settlement_update', {
        id: e.id,
        amount: e.amount,
        tx_hash: e.tx_hash.trim(),
        paid_at: e.paid_at.trim(),
        note: e.note.trim()
      })
      ElMessage.success('已修改')
      editOpen.value = false
      emit('changed')
    })
  } finally {
    saving.value = false
  }
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
    <!-- 地址、交易、备注三列一起分剩余宽度，不再全给备注 -->
    <el-table-column label="网络 / 地址" min-width="168">
      <template #default="{ row }">
        <div class="muted small">{{ row.network_name }}</div>
        <el-tooltip :content="row.to_address || '-'" placement="top">
          <span class="mono">{{ short(row.to_address) }}</span>
        </el-tooltip>
      </template>
    </el-table-column>
    <el-table-column label="交易" min-width="150">
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
    <el-table-column width="84" align="right">
      <template #default="{ row }">
        <el-button text size="small" :icon="Edit" aria-label="修改" @click="startEdit(row)" />
        <el-button text type="danger" size="small" :icon="Delete" aria-label="删除" @click="remove(row)" />
      </template>
    </el-table-column>
    <template #empty>
      <el-empty description="还没有打款记录。打完款点「记一笔打款」记下来，交易哈希、截图都选填" />
    </template>
  </el-table>

  <!-- 改一笔打款：写错了不用删掉重记，凭证也不用重新上传 -->
  <el-dialog v-model="editOpen" title="修改打款记录" :width="boxWidth" :top="boxTop" append-to-body>
    <el-form label-position="top">
      <el-form-item label="金额（USD）">
        <el-input-number v-model="edit.amount" :min="0.01" :precision="2" controls-position="right" class="full" />
      </el-form-item>
      <el-form-item label="交易哈希（选填）">
        <el-input v-model="edit.tx_hash" class="mono-input" placeholder="0x…" spellcheck="false" />
      </el-form-item>
      <el-form-item label="打款时间（北京时间）">
        <el-input v-model="edit.paid_at" placeholder="2026-10-16 15:30" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="edit.note" maxlength="255" />
      </el-form-item>
      <div class="muted small">凭证不能在这里换；要换的话删掉这条重记。改金额会重算所属批次的已结金额。</div>
    </el-form>
    <template #footer>
      <el-button @click="editOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.full { width: 100%; }
</style>
