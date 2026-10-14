<script setup lang="ts">
/**
 * 使用说明。上面三步讲清楚「怎么付」，下面常见问题默认全部收起，
 * 谁关心哪条就点哪条，不让说明本身变成负担。
 */
import { computed, ref } from 'vue'
import { dialogTop, dialogWidth, useViewport } from '@site/shared/responsive'
import { tt } from '../i18n'
import { claimRule, dismissGuide, helpOpen, walletIssue } from '../state'

const emit = defineEmits<{ goto: [view: 'wallet'] }>()

const { width: vw } = useViewport()
const boxWidth = computed(() => dialogWidth(vw.value, 560))
const boxTop = computed(() => dialogTop(vw.value))

const STEPS = [
  { title: 'step1_title', text: 'step1_text' },
  { title: 'step2_title', text: 'step2_text' },
  { title: 'step3_title', text: 'step3_text' }
]

// 常见问题：最容易让人慌的「确认中」放第一条
const FAQ = ['checking', 'replace', 'release', 'timeout', 'copy', 'settle'] as const
const open = ref('')

function answer(key: (typeof FAQ)[number]): string {
  // 超时规则跟着客户自己的超时设置走，直接复用领取卡片上那句
  return key === 'timeout' ? claimRule.value : tt.value(`faq_${key}_a`)
}

function start(): void {
  dismissGuide()
  helpOpen.value = false
}

function toWallet(): void {
  helpOpen.value = false
  emit('goto', 'wallet')
}
</script>

<template>
  <el-dialog v-model="helpOpen" :title="tt('help_title')" :width="boxWidth" :top="boxTop" append-to-body>
    <p class="intro">{{ tt('help_intro') }}</p>

    <ol class="steps">
      <li v-for="(s, i) in STEPS" :key="s.title" class="step">
        <span class="step-no" aria-hidden="true">{{ i + 1 }}</span>
        <div>
          <b>{{ tt(s.title) }}</b>
          <p>{{ tt(s.text) }}</p>
        </div>
      </li>
    </ol>

    <h3 class="faq-title">{{ tt('faq_title') }}</h3>
    <el-collapse v-model="open" accordion class="faq">
      <el-collapse-item v-for="k in FAQ" :key="k" :name="k" :title="tt(`faq_${k}_q`)">
        <p class="answer">{{ answer(k) }}</p>
        <el-button v-if="k === 'settle' && walletIssue" size="small" type="primary" plain @click="toWallet">
          {{ tt('wallet_set') }}
        </el-button>
      </el-collapse-item>
    </el-collapse>

    <template #footer>
      <el-button type="primary" @click="start">{{ tt('help_start') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.intro {
  margin: 0 0 14px;
  color: var(--el-text-color-regular);
}
.steps {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.step-no {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--el-color-primary);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
}
.step b {
  display: block;
  margin: 2px 0 2px;
}
.step p,
.answer {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  word-break: break-word;
}
.answer {
  margin-bottom: 8px;
}
.faq-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}
/* 问题文字可能比较长（尤其是乌兹别克语），允许换行而不是被截断 */
.faq :deep(.el-collapse-item__header) {
  height: auto;
  min-height: 44px;
  line-height: 1.5;
  padding: 10px 0;
  text-align: left;
}
</style>
