<script setup lang="ts">
/** 支付链接：只显示会话号缩写，点一下复制整条 */
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'
import { copyText, shortLink } from '@site/shared/format'

const props = defineProps<{ url?: string | null; void?: boolean; tip?: string; copied?: string }>()
const label = computed(() => (props.url ? shortLink(props.url) : ''))

async function copy(): Promise<void> {
  if (!props.url) return
  await copyText(props.url)
  ElMessage.success(props.copied ?? '已复制链接')
}
</script>

<template>
  <el-tooltip v-if="url" :content="`${url} · ${tip ?? '点击复制'}`" placement="top" :show-after="300">
    <button type="button" class="paylink" :class="{ 'is-void': props.void }" @click.stop="copy">
      <span class="text">{{ label }}</span>
      <el-icon class="icon"><CopyDocument /></el-icon>
    </button>
  </el-tooltip>
  <span v-else class="muted">-</span>
</template>

<style scoped>
.paylink {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font: 12px/1.6 var(--el-font-family-mono, ui-monospace, Consolas, monospace);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.paylink:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
/* 键盘用户也要看得见焦点 */
.paylink:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
  border-color: var(--el-color-primary);
}
.paylink .text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.paylink .icon {
  font-size: 12px;
  opacity: 0.6;
}
.paylink.is-void .text {
  text-decoration: line-through;
  opacity: 0.6;
}
.muted {
  color: var(--el-text-color-placeholder);
}
</style>
