<script setup lang="ts">
/** 结算：上面是待结算的客户（应结 − 已结，带收款地址，一键打款），下面是全部打款记录（分页，按客户筛） */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CopyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import PaylinksSettleModal from '@/components/paylinks/PaylinksSettleModal.vue'
import PaylinksSettlementTable from '@/components/paylinks/PaylinksSettlementTable.vue'
import { copyText } from '@/utils/ui'
import { networkName, paylinksAdmin, walletFresh, type AdminClient, type AdminSettlement } from '@/utils/paylinksAdmin'

const props = defineProps<{ clients: AdminClient[]; active?: boolean }>()
const emit = defineEmits<{ changed: []; 'open-order': [id: number]; 'client-orders': [id: number] }>()

const rows = ref<AdminSettlement[]>([])
const total = ref(0)
const sum = ref(0)
const page = ref(1)
const pageSize = ref(20)
const clientId = ref<number | undefined>(undefined)
const loading = ref(false)
const paying = ref<{ clientId?: number } | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await paylinksAdmin.settlements({ client_id: clientId.value, page: page.value, page_size: pageSize.value })
    rows.value = r.settlements
    total.value = r.total
    sum.value = r.sum
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}
watch(clientId, () => { page.value = 1; void load() })
watch([page, pageSize], () => void load())
watch(() => props.active, (on) => on && load(), { immediate: true })

const n = (v: string | number | null | undefined): number => Number(v ?? 0)
const owed = computed(() => props.clients.filter((c) => n(c.unsettled) > 0.004))
const clientOptions = computed(() => props.clients.map((c) => ({ value: c.id, label: c.display_name || c.username })))
const shortAddr = (s: string): string => (s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s)

function onSaved(): void {
  void load()
  emit('changed')
}
</script>

<template>
  <div class="pane">
    <a-card size="small" :title="`待结算（${owed.length} 个客户）`">
      <a-table v-if="owed.length" :data-source="owed" :row-key="(r: AdminClient) => r.id" :pagination="false" size="small"
        :columns="[{ title: '客户', key: 'name' }, { title: '应结', key: 'due', width: 100 }, { title: '已结', key: 'settled', width: 100 }, { title: '未结', key: 'left', width: 100 }, { title: '收款地址', key: 'wallet', width: 260 }, { title: '', key: 'act', width: 170 }]">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'"><b>{{ record.display_name || record.username }}</b></template>
          <template v-else-if="column.key === 'due'">${{ n(record.paid_usd).toFixed(2) }}</template>
          <template v-else-if="column.key === 'settled'"><span class="ok">${{ n(record.settled).toFixed(2) }}</span></template>
          <template v-else-if="column.key === 'left'"><b class="warn">${{ n(record.unsettled).toFixed(2) }}</b></template>
          <template v-else-if="column.key === 'wallet'">
            <template v-if="record.wallet_address">
              <span class="small muted">{{ networkName(record.wallet_network) }} · {{ record.wallet_token }}</span>
              <div>
                <a-tooltip :title="record.wallet_address"><span class="mono">{{ shortAddr(record.wallet_address) }}</span></a-tooltip>
                <a-button type="link" size="small" @click="copyText(record.wallet_address, '已复制地址')"><template #icon><CopyOutlined /></template></a-button>
                <a-tag v-if="walletFresh(record.wallet_updated_at)" color="red" :bordered="false">24h 内改过</a-tag>
              </div>
            </template>
            <a-tag v-else color="orange" :bordered="false">未设置</a-tag>
          </template>
          <template v-else-if="column.key === 'act'">
            <a-space :size="4">
              <a-button size="small" @click="emit('client-orders', record.id)">未结批次</a-button>
              <a-button size="small" type="primary" @click="paying = { clientId: record.id }">打款</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-result v-else status="success" title="没有待结算的" sub-title="所有客户的已付款都已结清" />
    </a-card>

    <a-card size="small" :title="`打款记录（${total} 笔 · 合计 ${n(sum).toFixed(2)}）`">
      <template #extra>
        <a-space>
          <a-select v-model:value="clientId" allow-clear placeholder="全部客户" :options="clientOptions" size="small" style="width: 130px" />
          <a-button size="small" :loading="loading" @click="load"><template #icon><ReloadOutlined /></template></a-button>
          <a-button size="small" type="primary" @click="paying = { clientId }"><template #icon><PlusOutlined /></template>记一笔打款</a-button>
        </a-space>
      </template>
      <a-spin :spinning="loading">
        <PaylinksSettlementTable :rows="rows" @changed="onSaved" @open-order="(id) => emit('open-order', id)" />
      </a-spin>
      <div class="pager">
        <a-pagination v-model:current="page" v-model:page-size="pageSize" :total="total" size="small" show-size-changer
          :page-size-options="['20', '50', '100']" :show-total="(t: number) => `共 ${t} 笔`" />
      </div>
    </a-card>
    <PaylinksSettleModal v-if="paying" :clients="clients" :client-id="paying.clientId" @saved="onSaved" @close="paying = null" />
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; gap: 16px; }
.pager { display: flex; justify-content: flex-end; margin-top: 10px; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.ok { color: #52c41a; }
.warn { color: #fa8c16; }
</style>
