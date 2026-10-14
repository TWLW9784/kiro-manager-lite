<script setup lang="ts">
/** 客户：新建 / 编辑 / 改密码 / 代填收款地址 / 强制下线 / 删除 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Link as LinkIcon, Plus, Refresh, SwitchButton, Tickets } from '@element-plus/icons-vue'
import { ref } from 'vue'
import { api, guard } from '@site/shared/api'
import { copyText, minutes, num, short, usd, walletFresh } from '@site/shared/format'
import { clients, loadClients, loadOverview, type AdminClient } from '../state'
import ClientModal from '../components/ClientModal.vue'

const emit = defineEmits<{ goto: [view: 'orders' | 'links', params?: Record<string, unknown>] }>()

const loading = ref(false)
const editing = ref<AdminClient | null | undefined>(undefined)

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

    <el-table :data="clients" size="small">
      <el-table-column label="客户" min-width="150">
        <template #default="{ row }">
          <b>{{ row.display_name || row.username }}</b>
          <div class="muted small">{{ row.username }}</div>
          <div v-if="row.note" class="muted small ellipsis">{{ row.note }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="84">
        <template #default="{ row }">
          <el-tag size="small" :type="row.enabled ? 'success' : undefined">{{ row.enabled ? '启用' : '已停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="收款地址" width="200">
        <template #default="{ row }">
          <template v-if="row.wallet_address">
            <div class="muted small">{{ row.wallet_token }}</div>
            <el-tooltip :content="row.wallet_address" placement="top">
              <span class="mono link" @click="copyText(row.wallet_address), ElMessage.success('已复制地址')">
                {{ short(row.wallet_address) }}
              </span>
            </el-tooltip>
            <el-tag v-if="row.wallet_network !== 'polygon'" size="small" type="danger">不是 Polygon</el-tag>
            <el-tag v-else-if="walletFresh(row.wallet_updated_at)" size="small" type="danger">24 小时内改过</el-tag>
          </template>
          <el-tag v-else size="small" type="warning">未设置</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="待付" width="70" align="right">
        <template #default="{ row }">{{ num(row.claimed) }}</template>
      </el-table-column>
      <el-table-column label="已付" width="96" align="right">
        <template #default="{ row }">
          {{ num(row.paid) }}
          <div class="muted small">今日 <b class="ok">{{ num(row.paid_today) }}</b></div>
        </template>
      </el-table-column>
      <el-table-column label="付客户 / 余额" width="156" align="right">
        <template #default="{ row }">
          <div class="num">
            {{ usd(row.due) }}
            <span v-if="row.unit_price !== null" class="muted small">· 每条 {{ usd(row.unit_price) }}</span>
          </div>
          <div class="muted small">客户实付 {{ usd(row.client_paid) }} · 赚 {{ usd(row.client_profit) }}</div>
          <div
            class="small"
            :class="num(row.balance) > 0 ? 'primary' : num(row.unsettled) > 0 ? 'warn' : 'muted'"
          >
            {{
              num(row.balance) > 0
                ? `已预付 ${usd(row.balance)}`
                : num(row.unsettled) > 0
                  ? `待结算 ${usd(row.unsettled)}`
                  : '已结清'
            }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="领取规则" width="150">
        <template #default="{ row }">
          <span class="small">每次 ≤ {{ row.max_claim }} 条 · {{ minutes(num(row.claim_timeout_minutes)) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="最近登录" width="110">
        <template #default="{ row }"><span class="small muted">{{ row.last_login_at?.slice(5, 16) ?? '-' }}</span></template>
      </el-table-column>
      <el-table-column width="170" align="right">
        <template #default="{ row }">
          <el-tooltip content="他的批次" placement="top">
            <el-button text size="small" :icon="Tickets" @click="emit('goto', 'orders', { clientId: row.id })" />
          </el-tooltip>
          <el-tooltip content="他的链接" placement="top">
            <el-button text size="small" :icon="LinkIcon" @click="emit('goto', 'links', { clientId: row.id })" />
          </el-tooltip>
          <el-tooltip content="编辑 / 改密码 / 收款地址" placement="top">
            <el-button text size="small" :icon="Edit" @click="editing = row" />
          </el-tooltip>
          <el-tooltip content="强制下线" placement="top">
            <el-button text size="small" :icon="SwitchButton" @click="kick(row)" />
          </el-tooltip>
          <el-tooltip content="删除" placement="top">
            <el-button text size="small" type="danger" :icon="Delete" @click="remove(row)" />
          </el-tooltip>
        </template>
      </el-table-column>
      <template #empty><el-empty description="还没有客户，点右上角新建" /></template>
    </el-table>
  </el-card>

  <ClientModal v-if="editing !== undefined" :client="editing" @close="editing = undefined" @saved="reload" />
</template>

<style scoped>
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.link { cursor: pointer; }
.link:hover { color: var(--el-color-primary); }
</style>
