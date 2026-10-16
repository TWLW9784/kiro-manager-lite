<script setup lang="ts">
/**
 * 导出代付 TXT：填一个「发给谁」，生成「序号. 链接」一行一条的纯文本。
 * 整段发给代付的人即可，对方按序号逐个打开付款。可落盘，也可直接复制整段去发消息。
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { CopyOutlined, DownloadOutlined, FileTextOutlined } from '@ant-design/icons-vue'
import { auditExport } from '@/utils/audit'
import { useAccountsStore } from '@/stores/accounts'
import { copyText } from '@/utils/ui'
import {
  buildPaymentLinkTxt,
  paymentLinkBrief,
  paymentLinkTxtFilename,
  type PaymentLinkTxtOptions
} from '@/utils/paymentLinks'
import type { Account } from '@shared/types'

const props = defineProps<{ accounts: Account[] }>()
const emit = defineEmits<{ close: [] }>()

/** 上次填的收款人记在本地：同一个人连着发几批时不用重复输入 */
const RECIPIENT_KEY = 'kal.paymentLink.recipient'

function readRecipient(): string {
  try {
    return localStorage.getItem(RECIPIENT_KEY) || ''
  } catch {
    return ''
  }
}

const recipient = ref(readRecipient())
const includeAmount = ref(true)
const includeEmail = ref(false)
const saving = ref(false)

const options = computed<PaymentLinkTxtOptions>(() => ({
  recipient: recipient.value,
  includeAmount: includeAmount.value,
  includeEmail: includeEmail.value
}))

const content = computed(() => buildPaymentLinkTxt(props.accounts, options.value))

function remember(): void {
  try {
    localStorage.setItem(RECIPIENT_KEY, recipient.value.trim())
  } catch {
    /* 不可写就不记 */
  }
}

async function save(): Promise<void> {
  if (!props.accounts.length || saving.value) return
  saving.value = true
  try {
    const filename = paymentLinkTxtFilename(recipient.value, props.accounts.length)
    const res = await window.api.exportToFile(content.value, filename)
    if (!res.success) return void message.error(res.error || '导出失败')
    if (!res.data?.saved) return
    remember()
    logExport('导出代付 TXT', res.data.path ?? filename)
    // 发出去的链接不再推到网站（除非之后手动分配给客户）
    useAccountsStore().markPaymentLinksExported(props.accounts, recipient.value)
    message.success(`已导出 ${props.accounts.length} 条代付链接`)
    emit('close')
  } finally {
    saving.value = false
  }
}

/** 记下发给了谁、带没带金额 / 邮箱；要在标成「已发出」之前记，才看得出以前发给过谁 */
function logExport(how: string, to?: string): void {
  const who = recipient.value.trim()
  const extras = [includeAmount.value && '含金额', includeEmail.value && '附邮箱'].filter(Boolean).join('，')
  auditExport(`${how}（${who ? `发给 ${who}` : '未填接收人'}${extras ? `，${extras}` : ''}）`, props.accounts, {
    to,
    detail: paymentLinkBrief,
    unit: '条支付链接'
  })
}

function copy(): void {
  if (!props.accounts.length) return
  remember()
  copyText(content.value, `已复制 ${props.accounts.length} 条代付链接`)
  logExport('复制代付 TXT')
  useAccountsStore().markPaymentLinksExported(props.accounts, recipient.value)
  emit('close')
}
</script>

<template>
  <a-modal :open="true" width="680px" centered :footer="null" @cancel="emit('close')">
    <template #title>
      <span class="title">
        <FileTextOutlined />
        导出代付 TXT
        <a-tag style="margin: 0">{{ props.accounts.length }} 条</a-tag>
      </span>
    </template>

    <div class="form-row">
      <span class="label">发给</span>
      <a-input
        v-model:value="recipient"
        placeholder="代付的人（可留空）"
        :maxlength="24"
        allow-clear
        style="max-width: 220px"
        @press-enter="save"
      />
      <a-checkbox v-model:checked="includeAmount">附档位与合计金额</a-checkbox>
      <a-tooltip title="每行链接后面附上邮箱与档位。发给代付的人一般不需要，自己留档时可以勾上">
        <a-checkbox v-model:checked="includeEmail">附邮箱</a-checkbox>
      </a-tooltip>
    </div>

    <div class="preview mono">{{ content }}</div>

    <a-space style="width: 100%; justify-content: flex-end; margin-top: 14px">
      <a-button @click="emit('close')">取消</a-button>
      <a-button :disabled="!props.accounts.length" @click="copy">
        <template #icon><CopyOutlined /></template>
        复制整段
      </a-button>
      <a-button
        type="primary"
        :loading="saving"
        :disabled="!props.accounts.length"
        @click="save"
      >
        <template #icon><DownloadOutlined /></template>
        保存为 TXT
      </a-button>
    </a-space>
  </a-modal>
</template>

<style scoped>
.title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.form-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.label {
  font-weight: 600;
}

/* 预览保留换行与空格，长链接按字符换行，整体可滚动 */
.preview {
  max-height: 46vh;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--kal-block-bg);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
