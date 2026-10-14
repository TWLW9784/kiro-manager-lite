<script setup lang="ts">
/** 管理后台：总览 / 批次 / 结算 / 客户 / 链接 / 日志 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Close, DataLine, Document, Expand, Link, List, Sort, User } from '@element-plus/icons-vue'
// Element Plus 自带的文字（分页「50/page」、日期选择器、「No Data」）默认是英文
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { guard } from '@site/shared/api'
import { loadClients, loadOverview, overview } from './state'
import OverviewView from './views/OverviewView.vue'
import OrdersView from './views/OrdersView.vue'
import SettlementsView from './views/SettlementsView.vue'
import ClientsView from './views/ClientsView.vue'
import LinksView from './views/LinksView.vue'
import LogsView from './views/LogsView.vue'

const VIEWS = ['overview', 'orders', 'settlements', 'clients', 'links', 'logs'] as const
type View = (typeof VIEWS)[number]
const TITLES: Record<View, string> = {
  overview: '总览',
  orders: '批次',
  settlements: '结算',
  clients: '客户',
  links: '链接',
  logs: '日志'
}
const NAV: { key: View; icon: unknown }[] = [
  { key: 'overview', icon: DataLine },
  { key: 'orders', icon: Document },
  { key: 'settlements', icon: Sort },
  { key: 'clients', icon: User },
  { key: 'links', icon: Link },
  { key: 'logs', icon: List }
]

const hash = location.hash.slice(1) as View
const view = ref<View>(VIEWS.includes(hash) ? hash : 'overview')
const navOpen = ref(false)
/** 跳转时带的筛选：客户页 → 批次页、结算页 → 批次页 */
const jump = ref<{ clientId?: number; settle?: string; orderId?: number; linkStatus?: string }>({})

function go(next: View, params: typeof jump.value = {}): void {
  jump.value = params
  view.value = next
  navOpen.value = false
  history.replaceState(null, '', `#${next}`)
}

const admin = document.getElementById('app')?.dataset.admin ?? 'admin'

async function logout(): Promise<void> {
  await fetch('api.php?action=admin_logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
}

const desktopOk = computed(() => {
  const o = overview.value
  if (!o?.desktop) return false
  return Date.parse(o.now.replace(' ', 'T')) - Date.parse(o.desktop.at.replace(' ', 'T')) <= 600000
})

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void guard(async () => {
    await Promise.all([loadClients(), loadOverview()])
  })
  timer = setInterval(() => {
    if (document.hidden || document.querySelector('.el-overlay, .el-drawer__wrapper')) return
    void guard(loadOverview)
  }, 15000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <el-config-provider :locale="zhCn">
  <!-- wide：后台表格列多，内容区最大宽度放到 1600（门户 1400） -->
  <div class="shell wide" :class="{ 'nav-open': navOpen }">
    <div v-if="navOpen" class="nav-backdrop" @click="navOpen = false" />
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">P</div>
        <div class="brand-text">
          <b>管理后台</b>
          <span>Payment links</span>
        </div>
        <el-button class="nav-close" text :icon="Close" aria-label="关闭菜单" @click="navOpen = false" />
      </div>

      <el-menu class="nav" :default-active="view" @select="(k: string) => go(k as View)">
        <el-menu-item v-for="item in NAV" :key="item.key" :index="item.key">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>
            <span>{{ TITLES[item.key] }}</span>
            <el-badge
              v-if="item.key === 'settlements' && overview?.settle.unsettled_orders"
              :value="overview.settle.unsettled_orders"
              type="danger"
              class="nav-badge"
            />
            <el-badge
              v-else-if="item.key === 'orders' && overview?.settle.open_orders"
              :value="overview.settle.open_orders"
              type="info"
              class="nav-badge"
            />
          </template>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-foot">
        <div class="user">
          <el-avatar :size="30">A</el-avatar>
          <div class="user-text">
            <b>{{ admin }}</b>
            <span :class="desktopOk ? 'ok' : 'danger'">● {{ desktopOk ? '桌面端在线' : '桌面端离线' }}</span>
          </div>
        </div>
        <el-button size="small" @click="logout">退出登录</el-button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <el-button class="nav-toggle" text :icon="Expand" aria-label="菜单" @click="navOpen = true" />
        <h1>{{ TITLES[view] }}</h1>
      </header>
      <main class="content">
        <OverviewView v-if="view === 'overview'" @goto="go" />
        <OrdersView
          v-else-if="view === 'orders'"
          :client-id="jump.clientId"
          :settle="jump.settle"
          :order-id="jump.orderId"
          @goto="go"
        />
        <SettlementsView v-else-if="view === 'settlements'" @goto="go" />
        <ClientsView v-else-if="view === 'clients'" @goto="go" />
        <LinksView v-else-if="view === 'links'" :client-id="jump.clientId" :status="jump.linkStatus" />
        <LogsView v-else />
      </main>
    </div>
  </div>
  </el-config-provider>
</template>
