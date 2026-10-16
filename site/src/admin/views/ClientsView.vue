<script setup lang="ts">
/**
 * 客户：钱算清了没有就看这里（「你欠他 / 他有预付 / 已平」）。
 * 点一行看详情（批次 + 打款记录）；派单、记打款都能直接从这里开始。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Link as LinkIcon, Plus, Refresh, SwitchButton } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import { api, guard } from '@site/shared/api'
import { copyText, dt, num, short, usd, walletFresh } from '@site/shared/format'
import { clients, loadClients, loadOverview, type AdminClient } from '../state'
import ClientModal from '../components/ClientModal.vue'
import ClientDrawer from '../components/ClientDrawer.vue'
import OrderModal from '../components/OrderModal.vue'
import SettleModal from '../components/SettleModal.vue'

// clientId：从总览「要处理的事」点过来时直接打开这个客户的详情
const props = defineProps<{ clientId?: number }>()
const emit = defineEmits<{ goto: [view: 'orders' | 'links', params?: Record<string, unknown>] }>()

const loading = ref(false)
const editing = ref<AdminClient | null | undefined>(undefined)
// 详情抽屉按 id 记，列表刷新后自动拿到最新的余额
const detailId = ref<number | null>(props.clientId ?? null)
const detail = computed(() => clients.value.find((c) => c.id === detailId.value) ?? null)
const dispatchFor = ref<number | null>(null)
const payFor = ref<number | null>(null)

/** 余额 = 已付他 − 他完成的价值 */
function verdict(c: AdminClient): { text: string; cls: string } {
  const b = num(c.balance)
  if (Math.abs(b) < 0.005) return { text: '已平', cls: 'muted' }
  return b > 0 ? { text: `预付 ${usd(b)}`, cls: 'primary' } : { text: `你欠 ${usd(-b)}`, cls: 'warn' }
}

const reload = (): void =>
  void guard(async () => {
    loading.value = true
    try {
      await Promise.all([loadClients(), loadOverview()])
    } finally {
      loading.value = false
    }
  })

async function kick(c: AdminClient): Promise<void> {
  await guard(async () => {
    await api.admin('client_kick', { id: c.id })
    ElMessage.success(`${c.username} 已被强制下线`)
  })
}

async function remove(c: AdminClient): Promise<void> {
  if (num(c.paid) > 0) return void ElMessage.error('这个客户有已付款记录，不能删除，请改为停用')
  try {
    await ElMessageBox.confirm('删除后该账号不能再登录；手里还没付的链接会收回并换成新链接。', `删除客户 ${c.username}`, {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  await guard(async () => {
    await api.admin('client_delete', { id: c.id })
    ElMessage.success('已删除')
    reload()
  })
}

/** 详情里点批次：抽屉叠抽屉不好用，直接跳到批次页并打开它 */
function openOrder(id: number): void {
  detailId.value = null
  emit('goto', 'orders', { orderId: id })
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>客户账号<span class="muted small"> {{ clients.length }}</span></h2>
        <el-button :icon="Refresh" :loading="loading" @click="reload" />
        <el-button type="primary" :icon="Plus" @click="editing = null">新建客户</el-button>
      </div>
    </template>

    <!-- 点一行看详情；操作列里的按钮用 .stop，别同时打开抽屉 -->
    <el-table :data="clients" size="small" @row-click="(r: AdminClient) => (detailId = r.id)">
      <el-table-column label="客户" min-width="150">
        <template #default="{ row }">
          <b>{{ row.display_name || row.username }}</b>
          <el-tag v-if="!row.enabled" size="small" class="off">已停用</el-tag>
          <div class="muted small">{{ row.username }}</div>
          <div v-if="row.note" class="muted small ellipsis">{{ row.note }}</div>
        </template>
      </el-table-column>
      <el-table-column label="收款地址" min-width="180">
        <template #default="{ row }">
          <template v-if="row.wallet_address">
            <el-tooltip :content="row.wallet_address" placement="top">
              <span class="mono link" @click.stop="copyText(row.wallet_address), ElMessage.success('已复制地址')">
                {{ short(row.wallet_address) }}
              </span>
            </el-tooltip>
            <el-tag v-if="row.wallet_network !== 'polygon'" size="small" type="danger">不是 Polygon</el-tag>
            <el-tag v-else-if="walletFresh(row.wallet_updated_at)" size="small" type="danger">24 小时内改过</el-tag>
          </template>
          <el-tag v-else size="small" type="warning">未设置</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="完成" width="96" align="right">
        <template #default="{ row }">
          {{ num(row.paid) }}
          <div class="muted small">今日 <b class="ok">{{ num(row.paid_today) }}</b> · 待付 {{ num(row.claimed) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="已付他 / 完成价值" min-width="150" align="right">
        <template #default="{ row }">
          <span class="num">{{ usd(row.settled) }}</span>
          <div class="muted small">{{ usd(row.due) }}</div>
        </template>
      </el-table-column>
      <!-- 对账结论：钱经常跨批次抵，所以看客户总账 -->
      <el-table-column label="余额" width="120" align="right">
        <template #default="{ row }">
          <b :class="verdict(row).cls">{{ verdict(row).text }}</b>
        </template>
      </el-table-column>
      <el-table-column label="最近登录" width="104">
        <template #default="{ row }"><span class="small muted">{{ dt(row.last_login_at) }}</span></template>
      </el-table-column>
      <el-table-column min-width="230" align="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" plain @click.stop="dispatchFor = row.id">派单</el-button>
          <el-button size="small" @click.stop="payFor = row.id">记打款</el-button>
          <el-tooltip content="他的链接" placement="top">
            <el-button text size="small" :icon="LinkIcon" @click.stop="emit('goto', 'links', { clientId: row.id })" />
          </el-tooltip>
          <el-tooltip content="编辑 / 改密码 / 收款地址" placement="top">
            <el-button text size="small" :icon="Edit" @click.stop="editing = row" />
          </el-tooltip>
          <el-tooltip content="强制下线" placement="top">
            <el-button text size="small" :icon="SwitchButton" @click.stop="kick(row)" />
          </el-tooltip>
          <el-tooltip content="删除" placement="top">
            <el-button text size="small" type="danger" :icon="Delete" @click.stop="remove(row)" />
          </el-tooltip>
        </template>
      </el-table-column>
      <template #empty><el-empty description="还没有客户，点右上角新建" /></template>
    </el-table>
  </el-card>

  <ClientModal v-if="editing !== undefined" :client="editing" @close="editing = undefined" @saved="reload" />
  <ClientDrawer
    v-if="detail"
    :key="detail.id"
    :client="detail"
    @close="detailId = null"
    @changed="reload"
    @dispatch="dispatchFor = detail.id"
    @pay="payFor = detail.id"
    @edit="editing = detail"
    @open-order="openOrder"
  />
  <OrderModal v-if="dispatchFor !== null" :client-id="dispatchFor" @close="dispatchFor = null" @saved="reload" />
  <SettleModal v-if="payFor !== null" :client-id="payFor" @close="payFor = null" @saved="reload" />
</template>

<style scoped>
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.off { margin-left: 6px; }
:deep(.el-table__row) { cursor: pointer; }
.link { cursor: pointer; }
.link:hover { color: var(--el-color-primary); }
</style>
