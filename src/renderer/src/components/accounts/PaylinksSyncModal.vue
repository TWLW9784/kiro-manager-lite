<script setup lang="ts">
/**
 * 代付链接网站同步设置：网站地址、同步密钥、开关，以及立即同步 / 上次结果。
 * 开启后应用在后台每分钟同步一次（见 utils/paylinksSync），不用停在这个页面。
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { CloudSyncOutlined, SyncOutlined } from '@ant-design/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { formatDateTime } from '@/utils/format'
import { paylinksSyncState, startPaylinksSync, syncNow } from '@/utils/paylinksSync'

const emit = defineEmits<{ close: [] }>()
const settingsStore = useSettingsStore()

const enabled = ref(settingsStore.settings.paylinksSyncEnabled)
const serverUrl = ref(settingsStore.settings.paylinksServerUrl)
const token = ref(settingsStore.settings.paylinksSyncToken)
/**
 * 已有的待付款链接要不要也推上去。默认不推：它们可能已经用 TXT 发给别人了，
 * 再挂到网站上会被第二个人领到、两人付同一条。确认都没发出去过才勾。
 */
const includeExisting = ref(settingsStore.settings.paylinksSyncSince === 0 && settingsStore.settings.paylinksSyncEnabled)
const saving = ref(false)
const firstEnable = computed(() => !settingsStore.settings.paylinksSyncEnabled && enabled.value)

const state = computed(() => paylinksSyncState.value)
const valid = computed(() => /^https:\/\/\S+$/i.test(serverUrl.value.trim()) && token.value.trim().length >= 16)

async function save(runNow: boolean): Promise<void> {
  if (enabled.value && !valid.value) return void message.warning('请填写 https:// 开头的网站地址和同步密钥')
  saving.value = true
  try {
    await settingsStore.update({
      paylinksSyncEnabled: enabled.value,
      paylinksServerUrl: serverUrl.value.trim().replace(/\/+$/, ''),
      paylinksSyncToken: token.value.trim(),
      // 第一次开启时定下推送起点；勾了「已有的也推」就从 0 开始
      ...(firstEnable.value || includeExisting.value
        ? { paylinksSyncSince: includeExisting.value ? 0 : Date.now() }
        : {})
    })
    startPaylinksSync()
    if (runNow && enabled.value) {
      await syncNow()
      if (state.value.lastError) message.error(`同步失败：${state.value.lastError}`)
      else message.success(`同步成功：${state.value.lastSummary}`)
    } else {
      message.success(enabled.value ? '已开启网站同步' : '已关闭网站同步')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal :open="true" width="560px" centered :footer="null" @cancel="emit('close')">
    <template #title>
      <span class="title"><CloudSyncOutlined />代付链接网站同步</span>
    </template>

    <a-form layout="vertical">
      <a-form-item label="网站地址">
        <a-input v-model:value="serverUrl" placeholder="https://paylinks.example.com" allow-clear />
      </a-form-item>
      <a-form-item label="同步密钥" extra="网站 inc/config.php 里的 sync_token，与客户登录密码无关">
        <a-input-password v-model:value="token" placeholder="sync_token" />
      </a-form-item>
      <a-form-item>
        <a-checkbox v-model:checked="enabled">开启同步（后台每分钟一次，不用停在本页面）</a-checkbox>
      </a-form-item>
      <a-form-item v-if="enabled" extra="不勾只推开启之后新提取的。已有的待付款可能已经用 TXT 发出去过，挂到网站上会被第二个人领到">
        <a-checkbox v-model:checked="includeExisting">已有的待付款链接也推到网站（确认都没发给别人过才勾）</a-checkbox>
      </a-form-item>
    </a-form>

    <a-alert type="info" show-icon class="hint">
      <template #message>
        推到网站的只有链接、档位、金额，邮箱和凭证不出本机。网站上领走 3 小时未付、客户放回、链接失效、
        放久了重新生成更便宜的，都会在这里自动换新链接，每轮最多 6 条。
      </template>
    </a-alert>

    <div v-if="state.lastAt" class="status">
      <span class="muted">上次同步 {{ formatDateTime(state.lastAt) }}：</span>
      <span v-if="state.lastError" class="error">{{ state.lastError }}</span>
      <span v-else>{{ state.lastSummary }}</span>
    </div>

    <div class="footer">
      <a-button @click="emit('close')">关闭</a-button>
      <a-button :loading="saving" @click="save(false)">保存</a-button>
      <a-button type="primary" :loading="saving || state.running" @click="save(true)">
        <template #icon><SyncOutlined /></template>
        保存并立即同步
      </a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.title { display: inline-flex; align-items: center; gap: 8px; }
.hint { margin: 4px 0 12px; }
.status { font-size: 12px; margin-bottom: 12px; }
.muted { color: var(--kal-muted); }
.error { color: #ff4d4f; }
.footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
