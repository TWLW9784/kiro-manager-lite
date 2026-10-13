<script setup lang="ts">
/**
 * 粘贴文本导入账号：JSON / 卡密 / CSV / TXT 任选一种，格式自动识别。
 * 从文件导入走 ImportAccountsFileModal，两者共用 parseImportContent 与 store 的导入 action。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { ClearOutlined, CodeOutlined, CopyOutlined, ScanOutlined } from '@ant-design/icons-vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { displayEmail } from '@/utils/display'
import { copyText } from '@/utils/ui'
import { parseImportContent } from '@/utils/transfer'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AccountImportItem, BatchResult } from '@shared/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()

const text = ref('')
const importing = ref(false)
const result = ref<BatchResult | null>(null)

const placeholder = `支持以下任意一种格式：

1) 卡密：邮箱----密码----RefreshToken----ClientId----ClientSecret----登录方式
2) 精简 JSON 数组：[{ "email": "a@b.c", "refreshToken": "...", "provider": "BuilderId" }]
3) 本应用导出的完整 JSON（含用量、订阅快照）
4) CSV（带表头）/ TXT（邮箱,RefreshToken,昵称,登录方式）`

/**
 * 解析结果只算一次：预览与提交共用同一个 computed 缓存。
 * 粘贴几千行时，每次按键重新全量解析两遍的开销很可观。
 */
const parsed = computed(() => (text.value.trim() ? parseImportContent(text.value) : null))

/**
 * 已在账号列表里的 refreshToken：导入前就标出来、提交时直接略过，
 * 不必等联网校验完才报「已存在」，也免得同一个号被反复粘进来搞混。
 */
const existingTokens = computed(
  () => new Set(accountsStore.accounts.map((a) => a.credentials.refreshToken).filter(Boolean))
)

function isExisting(item: AccountImportItem): boolean {
  return existingTokens.value.has(item.refreshToken)
}

const newItems = computed(() => parsed.value?.items.filter((item) => !isExisting(item)) ?? [])
const duplicateCount = computed(() => (parsed.value?.items.length ?? 0) - newItems.value.length)

const preview = computed(() => {
  const data = parsed.value
  if (!data) return null
  if (data.fullData) {
    return { kind: '完整备份', count: data.fullData.accounts?.length ?? 0 }
  }
  return { kind: '凭证条目', count: data.items.length }
})

/** 识别出的条目清单：邮箱认不出来就显示 token 尾号，社交 / IdC 按有没有 clientId 区分 */
function itemLabel(item: AccountImportItem): string {
  if (item.email) return displayEmail(item.email, settingsStore.settings.privacyMode)
  return `RefreshToken …${item.refreshToken.slice(-8)}`
}

function itemKind(item: AccountImportItem): string {
  if (item.provider) return item.provider
  return item.clientId && item.clientSecret ? 'IdC' : '社交登录'
}

// ============ 监听剪贴板 ============

/**
 * 连续收集：开着的时候，在微信里对每条消息「右键 → 复制」，内容自动追加到下面的文本框，
 * 不用来回切窗口粘贴。只收能识别出 refreshToken 的内容，复制别的东西不受影响。
 */
const watching = ref(false)
let unsubscribe: (() => void) | null = null

async function startWatch(): Promise<void> {
  const res = await window.api.startClipboardWatch()
  if (!res.success) return void message.error(res.error || '开启剪贴板监听失败')
  unsubscribe?.()
  unsubscribe = window.api.onClipboardChanged(onClipboard)
  watching.value = true
}

function stopWatch(): void {
  unsubscribe?.()
  unsubscribe = null
  if (watching.value) void window.api.stopClipboardWatch()
  watching.value = false
}

function toggleWatch(on: boolean): void {
  if (on) void startWatch()
  else stopWatch()
}

function onClipboard(clip: string): void {
  const incoming = parseImportContent(clip).items
  if (!incoming.length) return
  const known = new Set(parsed.value?.items.map((item) => item.refreshToken) ?? [])
  const fresh = incoming.filter((item) => !known.has(item.refreshToken))
  if (!fresh.length) return void message.info({ content: '这条已经收集过了', key: 'clip', duration: 1.5 })
  text.value = text.value.trim() ? `${text.value.trimEnd()}\n${clip.trim()}\n` : `${clip.trim()}\n`
  const already = fresh.filter(isExisting).length
  const total = parsed.value?.items.length ?? 0
  message.success({
    content: `已收集 ${fresh.length} 条，共 ${total} 条${already ? `（其中 ${already} 条账号列表里已有）` : ''}`,
    key: 'clip',
    duration: 1.5
  })
}

onBeforeUnmount(stopWatch)

function clearText(): void {
  text.value = ''
  result.value = null
}

/** 导入几千条时日志可能上千行，只渲染前若干条，避免一次性塞入大量 DOM */
const MAX_VISIBLE_MESSAGES = 200
const visibleMessages = computed(() => result.value?.messages.slice(0, MAX_VISIBLE_MESSAGES) ?? [])
const hiddenMessageCount = computed(() =>
  Math.max(0, (result.value?.messages.length ?? 0) - MAX_VISIBLE_MESSAGES)
)

/** 复制完整日志：界面只渲染前 200 条，但排查问题需要全部内容 */
function copyLog(): void {
  const lines = result.value?.messages ?? []
  if (!lines.length) return
  copyText(lines.join('\n'), `已复制 ${lines.length} 条日志`)
}

const importConcurrency = computed(
  () => settingsStore.settings.importConcurrency || DEFAULT_SETTINGS.importConcurrency
)

/** 只展示本次导入自身的校验进度，不显示后台批量刷新之类的其它任务 */
const validationProgress = computed(() => {
  const task = accountsStore.task
  if (!importing.value || !task.running || task.type !== 'import-validation') return null
  return `校验进度 ${task.done}/${task.total}`
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      text.value = ''
      result.value = null
    }
  }
)

function close(): void {
  stopWatch()
  emit('update:open', false)
}

async function submit(): Promise<void> {
  const data = parsed.value
  if (!data) return void message.warning('请先粘贴要导入的内容')
  // 导入期间不再往文本框里追加，免得一边校验一边多出新条目
  stopWatch()

  importing.value = true
  try {
    if (data.fullData) {
      // 完整备份直接恢复，不逐个联网校验
      const res = accountsStore.importFullData(data.fullData)
      result.value = res
      message.success(`恢复完成：新增 ${res.success}，跳过 ${res.skipped}`)
      if (!res.failed) close()
      return
    }

    if (data.items.length === 0) {
      return void message.error('没有解析出有效凭证，请检查格式')
    }
    // 账号列表里已有的直接略过，不再联网校验
    const skippedExisting = duplicateCount.value
    if (!newItems.value.length) {
      return void message.info(`这 ${skippedExisting} 条账号列表里都已经有了`)
    }
    const res = await accountsStore.importItems(newItems.value)
    if (skippedExisting) {
      res.skipped += skippedExisting
      res.messages.unshift(`${skippedExisting} 条账号列表里已有（RefreshToken 相同），未重复导入`)
    }
    result.value = res
    if (res.success) {
      message.success(`导入完成：成功 ${res.success}，跳过 ${res.skipped}，失败 ${res.failed}`)
    } else {
      message.warning(`没有成功导入的账号（跳过 ${res.skipped}，失败 ${res.failed}）`)
    }
    // 全部处理成功则直接关闭；有失败时保留弹窗，方便查看导入日志
    if (res.success && !res.failed) close()
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <a-modal
    :open="props.open"
    width="700px"
    centered
    :confirm-loading="importing"
    ok-text="开始导入"
    cancel-text="关闭"
    :mask-closable="!importing"
    @ok="submit"
    @cancel="close"
  >
    <template #title>
      <span class="modal-title">
        <CodeOutlined />
        粘贴文本导入账号
      </span>
    </template>

    <!-- 连续收集：聊天记录里一条一个 JSON 时，逐条右键复制就行，不用切回来粘贴 -->
    <div class="watch-box" :class="{ on: watching }">
      <a-switch :checked="watching" :disabled="importing" @change="(v: any) => toggleWatch(!!v)" />
      <div class="watch-text">
        <div class="watch-title">
          <ScanOutlined />
          {{ watching ? '正在监听剪贴板…' : '监听剪贴板，连续收集' }}
        </div>
        <div class="muted small">
          打开后去微信里对每条 JSON 消息「右键 → 复制」，会自动追加到下面，重复的自动去掉；
          收集完回来点「开始导入」。也可以一次粘贴多条 JSON，中间夹着昵称、时间也能识别。
        </div>
      </div>
    </div>

    <a-textarea v-model:value="text" :rows="10" :placeholder="placeholder" />

    <div v-if="preview" class="preview-row">
      <a-tag color="blue">识别为 {{ preview.kind }}</a-tag>
      <span class="muted">共 {{ preview.count }} 条</span>
      <template v-if="preview.kind === '凭证条目'">
        <a-tag v-if="duplicateCount" :bordered="false">已有 {{ duplicateCount }} 条，将跳过</a-tag>
        <span class="muted">· 新导入 {{ newItems.length }} 条，联网校验并发 {{ importConcurrency }}</span>
      </template>
      <span class="spacer" />
      <a-button type="link" size="small" :disabled="importing" @click="clearText">
        <template #icon><ClearOutlined /></template>
        清空
      </a-button>
    </div>

    <!-- 识别出的条目逐条列出来：一眼看清收了哪些、哪些已经导过，不会搞混 -->
    <div v-if="parsed?.items.length" class="item-list">
      <div v-for="(item, index) in parsed.items" :key="item.refreshToken" class="item-row">
        <span class="muted index">#{{ index + 1 }}</span>
        <span class="item-label mono">{{ itemLabel(item) }}</span>
        <a-tag :bordered="false" class="kind-tag">{{ itemKind(item) }}</a-tag>
        <a-tag v-if="isExisting(item)" color="default" :bordered="false" class="kind-tag">已有</a-tag>
      </div>
    </div>

    <a-alert
      v-if="validationProgress"
      type="info"
      show-icon
      style="margin-top: 10px"
      :message="validationProgress"
    />

    <template v-if="result?.messages.length">
      <a-divider style="margin: 14px 0 10px" />
      <div class="log-head">
        <span class="section-title">导入日志</span>
        <!-- 复制的是全部日志，不只是界面上截断显示的那 200 条 -->
        <a-button type="text" size="small" @click="copyLog">
          <template #icon><CopyOutlined /></template>
          复制全部
        </a-button>
      </div>
      <div class="token-box mono" style="max-height: 140px">
        <div v-for="(line, i) in visibleMessages" :key="i">{{ line }}</div>
        <div v-if="hiddenMessageCount" class="muted">
          … 另有 {{ hiddenMessageCount }} 条未显示（避免一次渲染过多内容）
        </div>
      </div>
    </template>
  </a-modal>
</template>

<style scoped>
/* 标题与复制按钮同一行：标题左、按钮右 */
.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.modal-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.watch-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--kal-block-bg);
  transition: border-color 0.2s;
}

.watch-box.on {
  border-color: var(--kal-primary);
}

.watch-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.watch-box.on .watch-title {
  color: var(--kal-primary);
}

.small {
  font-size: 12px;
  line-height: 1.6;
}

.preview-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.spacer {
  flex: 1 1 auto;
}

.item-list {
  max-height: 150px;
  overflow: auto;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--kal-block-bg);
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
}

.index {
  flex: 0 0 34px;
}

.item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kind-tag {
  margin: 0;
  flex: 0 0 auto;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
