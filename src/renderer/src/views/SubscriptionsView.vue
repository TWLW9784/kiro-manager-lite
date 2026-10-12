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

const accountsStore = useAccountsStore()

const tab = ref<'extract' | 'records'>('extract')
const extracting = ref(false)

const freeCount = computed(() => accountsStore.stats.bySubscription.Free)
const pendingCount = computed(() => accountsStore.stats.byPaymentState.pending)
const paidCount = computed(() => accountsStore.stats.byPaymentState.paid)
</script>

<template>
  <div class="subscriptions-page">
    <div class="page-head">
      <a-radio-group v-model:value="tab" button-style="solid">
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
      <a-tag color="green" :bordered="false">已开通 {{ paidCount }}</a-tag>
    </div>

    <div class="page-body">
      <PaymentLinkExtractPane
        v-show="tab === 'extract'"
        @running="(value) => (extracting = value)"
        @show-records="tab = 'records'"
      />
      <PaymentLinkRecordsPane v-show="tab === 'records'" />
    </div>
  </div>
</template>

<style scoped>
.subscriptions-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.page-head :deep(.ant-radio-button-wrapper) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.page-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  border-radius: 14px;
  background: var(--kal-card-bg);
  border: 1px solid var(--kal-border);
}

.spacer {
  flex: 1 1 auto;
}
</style>
