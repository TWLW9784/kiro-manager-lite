<script setup lang="ts">
/**
 * 布局风格的两个图标：左右布局（左侧一条导航栏）、上下布局（顶部一条导航栏）。
 * 与主题风格图标同一画法，线条用 currentColor，选中时跟着变主题色。
 */
import type { LayoutMode } from '@shared/types'

defineProps<{ mode: LayoutMode; size?: number }>()
</script>

<template>
  <svg
    :width="size ?? 22"
    :height="size ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <template v-if="mode === 'side'">
      <path d="M9 4v16" />
      <rect x="3.8" y="4.8" width="4.4" height="14.4" rx="1.2" fill="currentColor" stroke="none" opacity="0.35" />
    </template>
    <template v-else>
      <path d="M3 9h18" />
      <rect x="3.8" y="4.8" width="16.4" height="3.4" rx="1.2" fill="currentColor" stroke="none" opacity="0.35" />
    </template>
  </svg>
</template>
