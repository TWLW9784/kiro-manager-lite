<script setup lang="ts">
/**
 * 回收站：删除的账号保留 30 天，可勾选恢复或彻底删除。
 * 恢复时如果列表里已经有同一个号（删后又重新导入了），只从回收站移除，不会出现两条。
 */
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { DeleteOutlined, RestOutlined, RollbackOutlined, SearchOutlined } from '@ant-design/icons-vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { displayEmail } from '@/utils/display'
import { IDP_META, formatDateTime, subscriptionLabel, subscriptionMeta } from '@/utils/format'
import { confirmDanger } from '@/utils/ui'
import type { DeletedAccount } from '@shared/types'

const emit = defineEmits<{ close: [] }>()

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()
const privacy = computed(() => settingsStore.settings.privacyMode)

const items = ref<DeletedAccount[]>([])
const loading = ref(true)
const busy = ref(false)
const keyword = ref('')
const selectedKeys = ref<string[]>([])

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await window.api.getRecycleBin()
    items.value = res.success && res.data ? res.data : []
    const alive = new Set(items.value.map((item) => item.account.id))
    selectedKeys.value = selectedKeys.value.filter((id) => alive.has(id))
  } finally {
    loading.value = false
  }
}

onMounted(load)

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return items.value
  return items.value.filter((item) =>
    `${item.account.email} ${item.account.nickname ?? ''} ${item.account.note ?? ''}`.toLowerCase().includes(kw)
  )
})

const columns = [
  { title: '账号', key: 'email', ellipsis: true },
  { title: '订阅', key: 'sub', width: 110 },
  { title: '登录', key: 'idp', width: 90 },
  { title: '删除时间', key: 'deletedAt', width: 160 },
  { title: '', key: 'actions', width: 70 }
]

const rowSelection = computed(() => ({
  selectedRowKeys: selectedKeys.value,
  onChange: (keys: (string | number)[]) => (selectedKeys.value = keys.map(String)),
  preserveSelectedRowKeys: true
}))

async function restore(ids: string[]): Promise<void> {
  if (!ids.length || busy.value) return
  busy.value = true
  try {
    const res = await accountsStore.restoreAccounts(ids)
    if (res.error) return void message.error(res.error)
    const dup = res.duplicated ? `，${res.duplicated} 个已在列表中（只从回收站移除）` : ''
    message.success(`已恢复 ${res.restored} 个账号${dup}`)
    await load()
  } finally {
    busy.value = false
  }
}

function purge(ids?: string[]): void {
  const count = ids ? ids.length : items.value.length
  if (!count) return
  confirmDanger({
    title: ids ? `彻底删除 ${count} 个账号` : `清空回收站（${count} 个）`,
    content: '彻底删除后无法再恢复，账号凭证与积分记录都会清掉。',
    okText: '彻底删除',
    onOk: async () => {
      const res = await window.api.purgeAccounts(ids)
      if (!res.success) return void message.error(res.error || '删除失败')
      message.success(`已彻底删除 ${res.data?.purged ?? 0} 个账号`)
      await load()
    }
  })
}
</script>

<template>
  <a-modal :open="true" width="820px" centered :footer="null" @cancel="emit('close')">
    <template #title>
      <span class="title">
        <RestOutlined />
        回收站
        <a-tag style="margin: 0">{{ items.length }} 个</a-tag>
      </span>
    </template>

    <div class="toolbar">
      <span class="muted small">删除的账号在这里保留 30 天，过期自动清掉。</span>
      <span class="spacer" />
      <a-input v-model:value="keyword" allow-clear size="small" placeholder="搜索邮箱 / 昵称 / 备注" style="width: 220px">
        <template #prefix><SearchOutlined /></template>
      </a-input>
    </div>

    <a-table
      :columns="columns"
      :data-source="visible"
      :row-key="(record: DeletedAccount) => record.account.id"
      :row-selection="rowSelection"
      :loading="loading"
      size="small"
      :pagination="{ pageSize: 20, size: 'small', showSizeChanger: false, hideOnSinglePage: true }"
      :scroll="{ y: '46vh' }"
      :locale="{ emptyText: items.length ? '没有匹配的账号' : '回收站是空的' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'email'">{{ displayEmail(record.account.email, privacy) }}</template>
        <template v-else-if="column.key === 'sub'">
          <a-tag :color="subscriptionMeta(record.account.subscription.type).color" :bordered="false">
            {{ subscriptionLabel(record.account.subscription) }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'idp'">
          {{ IDP_META[record.account.idp as keyof typeof IDP_META]?.text ?? record.account.idp }}
        </template>
        <template v-else-if="column.key === 'deletedAt'">
          <span class="small">{{ formatDateTime(record.deletedAt) }}</span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-tooltip title="恢复">
            <a-button type="text" size="small" :disabled="busy" @click="restore([record.account.id])">
              <template #icon><RollbackOutlined /></template>
            </a-button>
          </a-tooltip>
        </template>
      </template>
    </a-table>

    <div class="footer">
      <a-button danger :disabled="!items.length || busy" @click="purge()">
        <template #icon><DeleteOutlined /></template>
        清空回收站
      </a-button>
      <a-button danger :disabled="!selectedKeys.length || busy" @click="purge(selectedKeys)">
        彻底删除（{{ selectedKeys.length }}）
      </a-button>
      <span class="spacer" />
      <a-button @click="emit('close')">关闭</a-button>
      <a-button type="primary" :loading="busy" :disabled="!selectedKeys.length" @click="restore(selectedKeys)">
        <template #icon><RollbackOutlined /></template>
        恢复（{{ selectedKeys.length }}）
      </a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.title { display: inline-flex; align-items: center; gap: 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.footer { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.spacer { flex: 1 1 auto; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
</style>
