<script setup lang="ts">
import { computed } from 'vue'
import { MenuFoldOutlined } from '@ant-design/icons-vue'
import kiroLogo from '@/assets/kiro-logo.png'
import ThemeModeIcon from '@/components/common/ThemeModeIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { useUpdateStore } from '@/stores/update'
import { useAppNav } from './useAppNav'

const settingsStore = useSettingsStore()
const updateStore = useUpdateStore()
const { items, selectedKeys, navigate, goHome, darkModeLabel, toggleDark } = useAppNav()

const collapsed = computed(() => settingsStore.settings.sidebarCollapsed)
</script>

<template>
  <aside
    class="app-sidebar"
    :class="{ collapsed }"
    :style="{ width: collapsed ? '80px' : '228px' }"
  >
    <div class="sidebar-brand">
      <!-- 点 logo 回主页；点「新版本」角标打开更新弹窗 -->
      <div class="brand-logo-wrap" role="link" aria-label="回到主页" @click="goHome">
        <img class="brand-logo" :src="kiroLogo" alt="Kiro Manager Lite" />
        <span v-if="updateStore.hasUpdate" class="brand-update-badge" @click.stop="updateStore.showModal">
          新版本
        </span>
      </div>
    </div>

    <a-menu
      :selected-keys="selectedKeys"
      :inline-collapsed="collapsed"
      mode="inline"
      style="border-inline-end: none; flex: 1 1 auto"
      @click="navigate"
    >
      <a-menu-item v-for="item in items" :key="item.key" :title="item.label">
        <template #icon><component :is="item.icon" /></template>
        <span>{{ item.label }}</span>
      </a-menu-item>
    </a-menu>

    <!-- 自己用 flex 排版，折叠态的居中不依赖 antd 组件的内部结构 -->
    <div class="sidebar-footer">
      <a-tooltip :title="collapsed ? darkModeLabel : ''" placement="right">
        <a-button
          type="text"
          class="footer-btn"
          @click="toggleDark"
        >
          <!-- 显示要切换到的那一边：深色时是太阳，浅色时是月亮，与设置里的主题风格图标同一套 -->
          <template #icon>
            <ThemeModeIcon :mode="settingsStore.isDark ? 'light' : 'dark'" :size="16" class="theme-icon" />
          </template>
          <span class="btn-text">{{ darkModeLabel }}</span>
        </a-button>
      </a-tooltip>
      <a-tooltip :title="collapsed ? '展开侧栏' : ''" placement="right">
        <a-button
          type="text"
          class="footer-btn"
          @click="settingsStore.update({ sidebarCollapsed: !collapsed })"
        >
          <!-- 图标不换组件、只转 180°：换组件会在折叠动画里闪一下 -->
          <template #icon><MenuFoldOutlined class="fold-icon" /></template>
          <span class="btn-text">收起侧栏</span>
        </a-button>
      </a-tooltip>
    </div>
  </aside>
</template>


<style scoped>
/* 折叠时文字收成 0 宽并淡出，不卸载 DOM：卸载会在宽度动画里闪一下 */
.btn-text {
  overflow: hidden;
  white-space: nowrap;
  max-width: 120px;
  opacity: 1;
  transition: max-width 0.18s ease, opacity 0.12s ease;
}

.app-sidebar.collapsed .btn-text {
  max-width: 0;
  opacity: 0;
}

.fold-icon {
  transition: transform 0.18s ease;
}

.app-sidebar.collapsed .fold-icon {
  transform: rotate(180deg);
}

.brand-logo-wrap {
  position: relative;
  width: 34px;
  height: 34px;
  cursor: pointer;
}

.brand-update-badge {
  position: absolute;
  top: -7px;
  right: -20px;
  z-index: 1;
  padding: 0 5px;
  border: 2px solid var(--kal-sidebar-bg);
  border-radius: 9px;
  color: #fff;
  background: #ff4d4f;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(255, 77, 79, 0.3);
}
</style>