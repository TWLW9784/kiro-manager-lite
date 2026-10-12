<script setup lang="ts">
/**
 * 提取记录：所有带支付链接标记的账号。
 *
 * 付款状态不单独存，靠账号的最新订阅档位算出来（见 shared/paymentLink），
 * 所以「刷新订阅状态」就是对这批账号跑一遍用量刷新：用量接口会顺带返回订阅档位，
 * accessToken 过期时还会自动续一次，不必先刷密钥。
 *
 * 操作范围与导出弹窗同一个规则：有勾选作用于勾选项，没勾选作用于当前筛选结果。
 */
import { computed, h, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  ClearOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileExcelOutlined,
  SearchOutlined,
  SyncOutlined
} from '@ant-design/icons-vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { displayEmail } from '@/utils/display'
import {
  PAYMENT_LINK_META,
  formatDateTime,
  formatPrice,
  subscriptionLabel,
  subscriptionMeta
} from '@/utils/format'
import { toPlain } from '@/utils/ipc'
import { now } from '@/utils/now'
import { confirmDanger, copyText } from '@/utils/ui'
import {
  amountDueText,
  buildPaymentLinkSheet,
  displayPaymentUrl,
  paymentLinkFilename,
  paymentLinkText
} from '@/utils/paymentLinks'
import {
  isPaymentLinkStale,
  paymentLinkState,
  paymentLinkTier,
  type PaymentLinkState
} from '@shared/paymentLink'
import type { Account } from '@shared/types'

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()

const privacy = computed(() => settingsStore.settings.privacyMode)

type StateFilter = 'all' | Exclude<PaymentLinkState, 'none'>
const stateFilter = ref<StateFilter>('all')
const keyword = ref('')
const selectedKeys = ref<string[]>([])

/** 带标记的账号，按提取时间倒序：最新提的在最上面 */
const marked = computed(() =>
  accountsStore.accounts
    .filter((a) => a.paymentLink)
    .sort((a, b) => b.paymentLink!.createdAt - a.paymentLink!.createdAt)
)

const counts = computed(() => {
  const result: Record<StateFilter, number> = { all: 0, pending: 0, paid: 0, other: 0 }
  for (const account of marked.value) {
    result.all++
    const state = paymentLinkState(account)
    if (state !== 'none') result[state]++
  }
  return result
})

const filterOptions = computed(() => [
  { value: 'all', label: `全部 ${counts.value.all}` },
  { value: 'pending', label: `待付款 ${counts.value.pending}` },
  { value: 'paid', label: `已开通 ${counts.value.paid}` },
  { value: 'other', label: `其他档位 ${counts.value.other}` }
])

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return marked.value.filter((a) => {
    if (stateFilter.value !== 'all' && paymentLinkState(a) !== stateFilter.value) return false
    if (kw && !`${a.email} ${a.nickname ?? ''} ${a.note ?? ''}`.toLowerCase().includes(kw)) return false
    return true
  })
})

/** 勾选项要和当前记录求交：中途清掉标记的账号不能还留在勾选里 */
const selected = computed(() => {
  const set = new Set(selectedKeys.value)
  return marked.value.filter((a) => set.has(a.id))
})

const targets = computed(() => (selected.value.length ? selected.value : visible.value))
const scopeSuffix = computed(() => `（${selected.value.length ? '已选' : ''}${targets.value.length}）`)

const columns = [
  { title: '账号', key: 'email', ellipsis: true },
  { title: '等级 / 实付', key: 'plan', width: 110 },
  { title: '付款状态', key: 'state', width: 120 },
  { title: '当前订阅', key: 'current', width: 100 },
  { title: '提取时间', key: 'createdAt', width: 150 },
  { title: '状态更新', key: 'checkedAt', width: 150 },
  { title: '', key: 'actions', width: 92 }
]

const rowSelection = computed(() => ({
  selectedRowKeys: selectedKeys.value,
  onChange: (keys: (string | number)[]) => (selectedKeys.value = keys.map(String)),
  preserveSelectedRowKeys: true
}))

function stateMeta(account: Account): { text: string; color: string; stale: boolean } {
  const state = paymentLinkState(account)
  const stale = state === 'pending' && isPaymentLinkStale(account.paymentLink!, now.value)
  return { ...PAYMENT_LINK_META[state], stale }
}

/** 状态更新时间早于提取时间：付款状态还没在提取之后核对过 */
function uncheckedSinceExtract(account: Account): boolean {
  return (account.lastCheckedAt ?? 0) < account.paymentLink!.createdAt
}

// ============ 刷新订阅状态 ============

const refreshing = ref(false)
const progress = ref('')
const ProgressText = (): ReturnType<typeof h> => h('span', null, progress.value)

async function refreshStatus(): Promise<void> {
  if (accountsStore.task.running) return void message.info('有批量刷新正在进行，请稍后再试')
  const ids = targets.value.map((a) => a.id)
  if (!ids.length) return void message.info('没有可刷新的账号')

  const key = 'payment-link-refresh'
  refreshing.value = true
  progress.value = `刷新订阅状态 0/${ids.length}`
  message.open({ key, type: 'loading', content: h(ProgressText), duration: 0 })
  const paidBefore = counts.value.paid
  try {
    const res = await accountsStore.runBatch(ids, 'check', (done, total) => {
      progress.value = `刷新订阅状态 ${done}/${total}`
    })
    message.destroy(key)
    const paidDelta = counts.value.paid - paidBefore
    const detail = `成功 ${res.success}${res.failed ? `，失败 ${res.failed}` : ''}${
      paidDelta > 0 ? `，新增已开通 ${paidDelta}` : ''
    }`
    if (res.failed) {
      message.warning(`订阅状态刷新完成：${detail}`)
      console.warn(res.messages)
    } else {
      message.success(`订阅状态刷新完成：${detail}`)
    }
  } finally {
    message.destroy(key)
    refreshing.value = false
  }
}

// ============ 复制 / 导出 / 清除 ============

function copyLinks(format: 'full' | 'url'): void {
  const list = targets.value
  if (!list.length) return
  copyText(paymentLinkText(list, format), `已复制 ${list.length} 条支付链接`)
}

const exporting = ref(false)

async function exportXlsx(): Promise<void> {
  const list = targets.value
  if (!list.length || exporting.value) return
  exporting.value = true
  try {
    const sheet = buildPaymentLinkSheet(list, accountsStore.groups)
    const res = await window.api.exportToXlsx(toPlain(sheet), paymentLinkFilename())
    if (!res.success) return void message.error(res.error || '导出失败')
    if (res.data?.saved) message.success(`已导出 ${sheet.rows.length} 条支付链接`)
  } finally {
    exporting.value = false
  }
}

function forget(ids: string[]): void {
  const set = new Set(ids)
  selectedKeys.value = selectedKeys.value.filter((id) => !set.has(id))
}

function clearMarks(list: Account[], title: string): void {
  if (!list.length) return
  confirmDanger({
    title,
    content: '只清除账号上的支付链接标记，不影响账号本身与已完成的订阅。清除后这些账号会重新出现在批量提取的候选里。',
    okText: '清除',
    onOk: () => {
      const ids = list.map((a) => a.id)
      const cleared = accountsStore.clearPaymentLinks(ids)
      forget(ids)
      message.success(`已清除 ${cleared} 个账号的支付链接标记`)
    }
  })
}

function clearTargets(): void {
  clearMarks(targets.value, `清除 ${targets.value.length} 个账号的支付链接标记`)
}

/** 已开通的标记留着也没用了，一键清掉，免得记录越堆越多 */
function clearPaid(): void {
  const list = marked.value.filter((a) => paymentLinkState(a) === 'paid')
  clearMarks(list, `清除 ${list.length} 个已开通账号的标记`)
}

function copyOne(account: Account): void {
  if (account.paymentLink) copyText(paymentLinkText([account], 'full'), '已复制：邮箱 订阅等级 支付链接')
}

async function openOne(account: Account): Promise<void> {
  if (!account.paymentLink) return
  const res = await window.api.openInAppBrowser(account.paymentLink.url, `支付 - ${account.email}`)
  if (!res.success) message.error(res.error || '打开支付页失败')
}

function clearOne(account: Account): void {
  accountsStore.clearPaymentLinks([account.id])
  forget([account.id])
}
</script>

<template>
  <div class="pane">
    <div class="toolbar">
      <a-radio-group v-model:value="stateFilter" button-style="solid" size="small">
        <a-radio-button v-for="item in filterOptions" :key="item.value" :value="item.value">
          {{ item.label }}
        </a-radio-button>
      </a-radio-group>
      <span class="spacer" />
      <a-input
        v-model:value="keyword"
        allow-clear
        size="small"
        placeholder="搜索邮箱 / 昵称 / 备注"
        style="width: 200px"
      >
        <template #prefix><SearchOutlined /></template>
      </a-input>
    </div>

    <a-table
      :columns="columns"
      :data-source="visible"
      :row-key="(record: Account) => record.id"
      :row-selection="rowSelection"
      size="small"
      :pagination="{ pageSize: 20, size: 'small', showSizeChanger: false, hideOnSinglePage: true }"
      :scroll="{ y: '42vh' }"
      :locale="{ emptyText: marked.length ? '没有匹配的记录' : '还没有提取过支付链接' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'email'">
          <div class="email-cell">
            <span>{{ displayEmail(record.email, privacy) }}</span>
            <span
              class="url-cell mono muted"
              :title="privacy ? undefined : record.paymentLink.url"
            >{{ displayPaymentUrl(record.paymentLink.url, privacy) }}</span>
          </div>
        </template>
        <template v-else-if="column.key === 'plan'">
          <div>{{ paymentLinkTier(record.paymentLink) }}</div>
          <div class="muted small" :title="`标价 ${formatPrice(record.paymentLink.amount, record.paymentLink.currency)}`">
            {{ amountDueText(record.paymentLink) }}
          </div>
        </template>
        <template v-else-if="column.key === 'state'">
          <a-tooltip
            :title="stateMeta(record).stale ? '提取已超过 24 小时，结算链接可能已失效，可重新提取' : undefined"
          >
            <a-tag :color="stateMeta(record).stale ? 'default' : stateMeta(record).color" :bordered="false">
              {{ stateMeta(record).text }}{{ stateMeta(record).stale ? '·可能过期' : '' }}
            </a-tag>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'current'">
          <a-tag :color="subscriptionMeta(record.subscription.type).color" :bordered="false">
            {{ subscriptionLabel(record.subscription) }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'createdAt'">
          <span class="small">{{ formatDateTime(record.paymentLink.createdAt) }}</span>
        </template>
        <template v-else-if="column.key === 'checkedAt'">
          <a-tooltip :title="uncheckedSinceExtract(record) ? '提取之后还没刷新过订阅状态' : undefined">
            <span class="small" :class="{ warn: uncheckedSinceExtract(record) }">
              {{ record.lastCheckedAt ? formatDateTime(record.lastCheckedAt) : '未刷新' }}
            </span>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space :size="0">
            <a-tooltip title="复制支付链接">
              <a-button type="text" size="small" @click="copyOne(record)">
                <template #icon><CopyOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="在内置浏览器打开">
              <a-button type="text" size="small" @click="openOne(record)">
                <template #icon><ExportOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="清除标记">
              <a-button type="text" size="small" danger @click="clearOne(record)">
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>

    <div class="footer">
      <a-button
        type="primary"
        :loading="refreshing"
        :disabled="!targets.length || (accountsStore.task.running && !refreshing)"
        @click="refreshStatus"
      >
        <template #icon><SyncOutlined /></template>
        刷新订阅状态{{ scopeSuffix }}
      </a-button>
      <a-dropdown :disabled="!targets.length">
        <a-button :disabled="!targets.length">
          <template #icon><CopyOutlined /></template>
          复制链接{{ scopeSuffix }}
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="full" @click="copyLinks('full')">邮箱 订阅等级 支付链接</a-menu-item>
            <a-menu-item key="url" @click="copyLinks('url')">仅链接（一行一个）</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <a-button :disabled="!targets.length" :loading="exporting" @click="exportXlsx">
        <template #icon><FileExcelOutlined /></template>
        导出 Excel{{ scopeSuffix }}
      </a-button>
      <span class="spacer" />
      <a-dropdown :disabled="!marked.length">
        <a-button danger :disabled="!marked.length">
          <template #icon><ClearOutlined /></template>
          清除标记
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="paid" :disabled="!counts.paid" @click="clearPaid">
              清除已开通（{{ counts.paid }}）
            </a-menu-item>
            <a-menu-item key="targets" :disabled="!targets.length" @click="clearTargets">
              清除{{ selected.length ? '已选' : '当前列表' }}（{{ targets.length }}）
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.spacer { flex: 1 1 auto; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.warn { color: #fa8c16; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

.email-cell { display: flex; flex-direction: column; min-width: 0; }
.email-cell > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url-cell { font-size: 11px; }
</style>
