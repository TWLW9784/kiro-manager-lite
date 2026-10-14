<script setup lang="ts">
/** 支付链接：只显示会话号缩写（cs_live_a1b2…z9），点一下复制整条；隐私模式下不显示 */
import { computed } from 'vue'
import { CopyOutlined } from '@ant-design/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { copyText } from '@/utils/ui'
import { shortLink } from '@/utils/paylinksAdmin'

const props = defineProps<{ url: string; void?: boolean }>()
const privacy = computed(() => useSettingsStore().settings.privacyMode)
const label = computed(() => (privacy.value ? '••••••••' : shortLink(props.url)))
</script>

<template>
  <a-tooltip :title="privacy ? '点击复制链接' : `${url}（点击复制）`" :overlay-style="{ maxWidth: '520px', wordBreak: 'break-all' }">
    <button type="button" :class="['paylink', { void: props.void }]" @click.stop="copyText(url, '已复制链接')">
      <span class="text">{{ label }}</span>
      <CopyOutlined class="icon" />
    </button>
  </a-tooltip>
</template>

<style scoped>
.paylink {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 1px 6px; border-radius: 4px;
  border: 0; background: var(--kal-block-bg); color: inherit; cursor: pointer;
  font: 12px/1.6 ui-monospace, Consolas, monospace;
}
.paylink:hover { color: var(--ant-color-primary, #1677ff); }
.paylink .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.paylink .icon { font-size: 11px; opacity: 0.6; flex: none; }
.paylink.void .text { text-decoration: line-through; opacity: 0.6; }
</style>
