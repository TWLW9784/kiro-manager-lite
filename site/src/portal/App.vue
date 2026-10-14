<script setup lang="ts">
/** 客户门户：侧栏 + 内容区。付款工作台 / 我的批次 / 已付款 / 结算记录 / 收款设置 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Close, Expand, Lightning, Document, QuestionFilled, Select, Sort, Wallet } from '@element-plus/icons-vue'
import { guard } from '@site/shared/api'
import { lang, tt } from './i18n'
import { helpOpen, loadMe, me } from './state'
import LangSwitch from './components/LangSwitch.vue'
import HelpDialog from './components/HelpDialog.vue'
import WorkView from './views/WorkView.vue'
import OrdersView from './views/OrdersView.vue'
import PaidView from './views/PaidView.vue'
import SettlementsView from './views/SettlementsView.vue'
import WalletView from './views/WalletView.vue'

const VIEWS = ['work', 'orders', 'paid', 'settlements', 'wallet'] as const
type View = (typeof VIEWS)[number]

const hash = location.hash.slice(1) as View
const view = ref<View>(VIEWS.includes(hash) ? hash : 'work')
const navOpen = ref(false)
const reloadKey = ref(0)

const NAV: { key: View; icon: unknown; label: string }[] = [
  { key: 'work', icon: Lightning, label: 'nav_work' },
  { key: 'orders', icon: Document, label: 'nav_orders' },
  { key: 'paid', icon: Select, label: 'nav_paid' },
  { key: 'settlements', icon: Sort, label: 'nav_settlements' },
  { key: 'wallet', icon: Wallet, label: 'nav_wallet' }
]

const stats = computed(() => me.value?.stats)

function go(next: View): void {
  view.value = next
  navOpen.value = false
  history.replaceState(null, '', `#${next}`)
}

watch(lang, () => (reloadKey.value += 1))

async function logout(): Promise<void> {
  await fetch('api.php?action=logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
}

/** 工作台与批次每 10 秒刷一次；弹窗 / 抽屉开着时不刷 */
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void guard(loadMe)
  timer = setInterval(() => {
    if (document.hidden) return
    if (document.querySelector('.el-overlay, .el-drawer__wrapper')) return
    if (document.activeElement?.matches?.('input, textarea, select')) return
    void guard(loadMe)
    if (view.value === 'work' || view.value === 'orders') reloadKey.value += 1
  }, 10000)
})
onUnmounted(() => clearInterval(timer))

const initial = computed(() => (me.value?.client.display_name || me.value?.client.username || '-').slice(0, 1).toUpperCase())
</script>

<template>
  <div class="shell" :class="{ 'nav-open': navOpen }">
    <div v-if="navOpen" class="nav-backdrop" @click="navOpen = false" />
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">P</div>
        <div class="brand-text">
          <b>{{ tt('title') }}</b>
          <span>{{ tt('portal_sub') }}</span>
        </div>
        <el-button class="nav-close" text :icon="Close" :aria-label="tt('close_menu')" @click="navOpen = false" />
      </div>

      <el-menu class="nav" :default-active="view" @select="(k: string) => go(k as View)">
        <el-menu-item v-for="item in NAV" :key="item.key" :index="item.key">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>
            <span>{{ tt(item.label) }}</span>
            <el-badge
              v-if="item.key === 'work' && stats?.claimed"
              :value="stats.claimed"
              type="warning"
              class="nav-badge"
            />
            <el-badge
              v-else-if="item.key === 'orders' && stats?.claimable"
              :value="`+${stats.claimable}`"
              type="warning"
              class="nav-badge"
            />
          </template>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-foot">
        <div class="user">
          <el-avatar :size="30">{{ initial }}</el-avatar>
          <div class="user-text">
            <b>{{ me?.client.display_name || me?.client.username }}</b>
            <span>{{ me ? tt('updated_at', { time: me.now.slice(11, 16) }) : '' }}</span>
          </div>
        </div>
        <!-- 语言切换挪到了右上角：手机上侧栏是收起的，放这里要先打开菜单才找得到 -->
        <el-button size="small" class="logout" @click="logout">{{ tt('logout') }}</el-button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <el-button class="nav-toggle" text :icon="Expand" :aria-label="tt('open_menu')" @click="navOpen = true" />
        <h1>{{ tt(`nav_${view}`) }}</h1>
        <div class="topbar-actions">
          <span class="muted small hide-sm">{{ tt('auto_refresh_s') }}</span>
          <el-button text type="primary" :icon="QuestionFilled" :aria-label="tt('help')" class="help-btn" @click="helpOpen = true">
            <span class="hide-sm">{{ tt('help') }}</span>
          </el-button>
          <LangSwitch />
        </div>
      </header>
      <main class="content">
        <WorkView v-if="view === 'work'" :key="`w${reloadKey}`" @goto="go" />
        <OrdersView v-else-if="view === 'orders'" :key="`o${reloadKey}`" />
        <PaidView v-else-if="view === 'paid'" />
        <SettlementsView v-else-if="view === 'settlements'" />
        <WalletView v-else />
      </main>
    </div>
    <HelpDialog @goto="go" />
  </div>
</template>

<style scoped>
/* 右上角：自动刷新提示 · 使用说明 · 语言 */
.topbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.help-btn {
  padding: 6px 8px;
}
/* 使用说明是新手找教程的入口，图标稍大一点，手机上只剩图标时也看得见 */
.help-btn :deep(.el-icon) {
  font-size: 18px;
}
.logout {
  align-self: flex-start;
}
/* 手机顶栏放不下文字：只留问号图标和语言按钮。
   选择器带 .topbar 是为了压过 Element Plus 自己给按钮里 span 设的样式 */
@media (max-width: 640px) {
  .topbar .hide-sm {
    display: none;
  }
  .topbar-actions {
    gap: 4px;
  }
}
</style>
