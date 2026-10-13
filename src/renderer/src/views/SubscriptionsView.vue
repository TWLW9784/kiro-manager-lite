<script setup lang="ts">
/**
 * 新订阅管理：专门给 Free 账号批量提取支付链接，以及跟进提取过的链接是否已付款。
 *
 * 两个面板都常驻（v-show 而不是 v-if）：提取跑到一半切去看记录，回来时进度还在。
 */
import { computed, ref } from 'vue'
import { CreditCardOutlined, UnorderedListOutlined } from '@ant-design/icons-vue'
import PaymentLinkExtractPane from '@/components/accounts/PaymentLinkExtractPane.vue'
import PaymentLinkRecordsPane from '@/components/accounts/PaymentLinkRecordsPane.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'

const accountsStore = useAccountsStore()
/** 顶栏控件尺寸跟随设置里的「控件尺寸」，与账户管理那一排一致 */
const settingsStore = useSettingsStore()

const tab = ref<'extract' | 'records'>('extract')
const extracting = ref(false)

const freeCount = computed(() => accountsStore.stats.bySubscription.Free)
const pendingCount = computed(() => accountsStore.stats.byPaymentState.pending)
const paidCount = computed(() => accountsStore.stats.byPaymentState.paid)
const expiredCount = computed(() => accountsStore.stats.byPaymentState.expired)
</script>

<template>
  <div class="subscriptions-page">
    <div class="page-head">
      <a-radio-group v-model:value="tab" button-style="solid" :size="settingsStore.toolbarSize">
        <a-radio-button value="extract">
          <CreditCardOutlined />
          批量提取
          <a-badge v-if="extracting" status="processing" style="margin-left: 4px" />
        </a-radio-button>
        <a-radio-button value="records">
          <UnorderedListOutlined />
          提取记录
        </a-radio-button>
      </a-radio-group>
      <span class="spacer" />
      <a-tag :bordered="false">Free {{ freeCount }}</a-tag>
      <a-tag color="orange" :bordered="false">待付款 {{ pendingCount }}</a-tag>
      <a-tag v-if="expiredCount" :bordered="false">已失效 {{ expiredCount }}</a-tag>
      <a-tag color="green" :bordered="false">已开通 {{ paidCount }}</a-tag>
    </div>

    <!-- 内容区与其他页面一致：页面本身不加外框，各块是独立的小卡片，由面板自己排 -->
    <div class="page-body">
      <PaymentLinkExtractPane
        v-show="tab === 'extract'"
        :active="tab === 'extract'"
        @running="(value) => (extracting = value)"
        @show-records="tab = 'records'"
      />
      <PaymentLinkRecordsPane v-show="tab === 'records'" :active="tab === 'records'" />
    </div>
  </div>
</template>

<style scoped>
/* 与账户管理 / API Key 管理同一套：整页铺满内容区，顶栏固定，内容区独立滚动 */
.subscriptions-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* 顶栏行与账户管理的 meta-bar 同款：左边切换，右边统计标签 */
.page-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
  margin-bottom: 12px;
  font-size: 13px;
}

.page-head :deep(.ant-radio-button-wrapper) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.page-head .ant-tag {
  margin: 0;
}

.page-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.spacer {
  flex: 1 1 auto;
}
</style>
