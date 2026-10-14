<script setup lang="ts">
/**
 * 网站上的链接明细：按客户 / 状态 / 档位 / 付款日期筛选，服务端分页。
 * 账号列显示本地邮箱：网站只有哈希，这里用本机账号反查，只在桌面端可见。
 * 可勾选「收回」：客户手里没付的标记换新，旧链接作废。
 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { ReloadOutlined, RollbackOutlined } from '@ant-design/icons-vue'
import PaylinkUrl from '@/components/paylinks/PaylinkUrl.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { displayEmail } from '@/utils/display'
import { confirmDanger } from '@/utils/ui'
import {
  LINK_STATUS_META,
  REFRESH_REASON_TEXT,
  paylinksAdmin,
  type AdminClient,
  type AdminLink
} from '@/utils/paylinksAdmin'

const props = defineProps<{ clients: AdminClient[]; active?: boolean }>()
const clientId = defineModel<number | undefined>('clientId')
const emit = defineEmits<{ changed: [AdminLink[]] }>()

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()
const privacy = computed(() => settingsStore.settings.privacyMode)

const statuses = ref<string[]>(['claimed', 'checking', 'paid'])
const tier = ref<string | undefined>(undefined)
const range = ref<[string, string] | null>(null)
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const rows = ref<AdminLink[]>([])
const loading = ref(false)
const selectedKeys = ref<number[]>([])

/** 网站 account_ref → 本机邮箱 */
const emailByRef = ref(new Map<string, string>())

async function loadRefs(): Promise<void> {
  const ids = accountsStore.accounts.filter((a) => a.paymentLink).map((a) => a.id)
  const res = await window.api.paylinksHashes({ accountIds: ids })
  if (!res.success || !res.data) return
  const map = new Map<string, string>()
  for (const [id, ref] of Object.entries(res.data.accountRefs)) {
    const account = accountsStore.get(id)
    if (account) map.set(ref, account.email)
  }
  emailByRef.value = map
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await paylinksAdmin.links({
      client_id: clientId.value,
      statuses: statuses.value,
      tier: tier.value,
      from: range.value?.[0],
      to: range.value?.[1],
      page: page.value,
      page_size: pageSize.value
    })
    rows.value = res.links
    total.value = res.total
    const alive = new Set(res.links.map((l) => l.id))
    selectedKeys.value = selectedKeys.value.filter((id) => alive.has(id))
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

watch([clientId, statuses, tier, range], () => {
  page.value = 1
  void load()
}, { deep: true })
watch([page, pageSize], () => void load())
watch(
  () => props.active,
  (on) => {
    if (!on) return
    void loadRefs()
    void load()
  },
  { immediate: true }
)

const clientOptions = computed(() =>
  props.clients.map((c) => ({ value: c.id, label: c.display_name || c.username }))
)
const statusOptions = Object.entries(LINK_STATUS_META).map(([value, meta]) => ({ value, label: meta.text }))
const tierOptions = ['pro', 'pro+', 'promax', 'power'].map((v) => ({ value: v, label: v }))

const columns = [
  { title: '账号', key: 'account', width: 210, ellipsis: true },
  { title: '链接', key: 'url', ellipsis: true },
  { title: '档位 / 金额', key: 'tier', width: 120 },
  { title: '状态', key: 'status', width: 110 },
  { title: '客户', key: 'client', width: 110, ellipsis: true },
  { title: '领取', key: 'claimed', width: 110 },
  { title: '付款', key: 'paid', width: 110 }
]

const rowSelection = computed(() => ({
  selectedRowKeys: selectedKeys.value,
  onChange: (keys: (string | number)[]) => (selectedKeys.value = keys.map(Number)),
  getCheckboxProps: (r: AdminLink) => ({ disabled: r.status === 'paid' || r.status === 'refresh' })
}))

const short = (v: string | null): string => (v ? v.slice(5, 16) : '-')

function emailOf(r: AdminLink): string {
  const email = emailByRef.value.get(r.account_ref)
  return email ? displayEmail(email, privacy.value) : `…${r.account_ref.slice(-8)}`
}

function revoke(): void {
  const ids = selectedKeys.value
  if (!ids.length) return
  confirmDanger({
    title: `收回 ${ids.length} 条链接`,
    content: '收回后这些链接作废，客户那边会消失；同步时会换成新链接重新上架。已付款的不受影响。',
    okText: '收回',
    onOk: async () => {
      try {
        const res = await paylinksAdmin.revokeLinks(ids)
        message.success(`已收回 ${res.revoked} 条`)
        selectedKeys.value = []
        await load()
        emit('changed', rows.value)
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e))
      }
    }
  })
}
</script>

<template>
  <a-card size="small" :title="`链接明细（${total}）`">
    <template #extra>
      <a-space>
        <a-button size="small" danger :disabled="!selectedKeys.length" @click="revoke">
          <template #icon><RollbackOutlined /></template>收回（{{ selectedKeys.length }}）
        </a-button>
        <a-button size="small" :loading="loading" @click="load">
          <template #icon><ReloadOutlined /></template>刷新
        </a-button>
      </a-space>
    </template>

    <div class="filters">
      <a-select v-model:value="clientId" allow-clear placeholder="全部客户" :options="clientOptions" style="width: 160px" />
      <a-select v-model:value="statuses" mode="multiple" allow-clear placeholder="全部状态" :options="statusOptions" style="min-width: 240px; flex: 1 1 240px" />
      <a-select v-model:value="tier" allow-clear placeholder="全部档位" :options="tierOptions" style="width: 120px" />
      <a-range-picker v-model:value="range" value-format="YYYY-MM-DD" :placeholder="['付款日期从', '到']" />
    </div>

    <a-table
      :columns="columns"
      :data-source="rows"
      :row-key="(r: AdminLink) => r.id"
      :row-selection="rowSelection"
      :loading="loading"
      size="small"
      :scroll="{ y: '46vh' }"
      :pagination="{
        current: page,
        pageSize,
        total,
        size: 'small',
        showSizeChanger: true,
        pageSizeOptions: ['20', '50', '100', '200'],
        onChange: (p: number, s: number) => ((page = p), (pageSize = s))
      }"
      :locale="{ emptyText: '没有符合条件的链接' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'account'">
          <div class="email">{{ emailOf(record) }}</div>
        </template>
        <template v-else-if="column.key === 'url'"><PaylinkUrl :url="record.url" :void="record.status === 'superseded'" /></template>
        <template v-else-if="column.key === 'tier'">
          <div>{{ record.tier }}</div>
          <div class="muted small">
            ${{ Number(record.amount_due ?? 0).toFixed(2) }} · ¥{{ Number(record.amount_cny ?? 0).toFixed(2) }}
          </div>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="LINK_STATUS_META[record.status as AdminLink['status']]?.color" :bordered="false">
            {{ LINK_STATUS_META[record.status as AdminLink['status']]?.text ?? record.status }}
          </a-tag>
          <div v-if="record.status === 'refresh' && record.refresh_reason" class="muted small">
            {{ REFRESH_REASON_TEXT[record.refresh_reason] ?? record.refresh_reason }}
          </div>
        </template>
        <template v-else-if="column.key === 'client'">{{ record.client ?? '-' }}</template>
        <template v-else-if="column.key === 'claimed'"><span class="small">{{ short(record.claimed_at) }}</span></template>
        <template v-else-if="column.key === 'paid'"><span class="small ok">{{ short(record.paid_at) }}</span></template>
      </template>
    </a-table>
  </a-card>
</template>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.ok { color: #52c41a; }
</style>
