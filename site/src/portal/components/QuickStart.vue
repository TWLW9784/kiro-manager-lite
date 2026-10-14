<script setup lang="ts">
/**
 * 新客户打开工作台时的三步提示。不弹窗、不挡操作：页面照常能用，
 * 提示就放在最上面。点「知道了」以后这台电脑上这个账号不再出现，
 * 想再看随时点右上角的「使用说明」。
 */
import { tt } from '../i18n'
import { dismissGuide, helpOpen } from '../state'

const STEPS = ['step1_title', 'step2_title', 'step3_title']
</script>

<template>
  <section class="quick-start" :aria-label="tt('qs_title')">
    <div class="qs-head">
      <b>{{ tt('qs_title') }}</b>
      <div class="qs-actions">
        <el-button size="small" type="primary" plain @click="helpOpen = true">{{ tt('qs_more') }}</el-button>
        <el-button size="small" text @click="dismissGuide">{{ tt('qs_dismiss') }}</el-button>
      </div>
    </div>
    <ol class="qs-steps">
      <li v-for="(s, i) in STEPS" :key="s">
        <span class="qs-no" aria-hidden="true">{{ i + 1 }}</span>
        <span>{{ tt(s) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.quick-start {
  border: 1px solid var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.qs-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.qs-head b {
  flex: 1 1 auto;
}
.qs-actions {
  display: flex;
  gap: 6px;
}
/* 三步固定三列：中文一行放得下，英文 / 乌兹别克语长了就在格子里换行，不会挤乱 */
.qs-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.qs-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--el-text-color-regular);
  line-height: 1.35;
}
.qs-no {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
/* 手机 / 平板上按钮要点得准：small 默认只有 24px 高，断点与 layout.css 一致 */
@media (max-width: 1080px) {
  .qs-actions :deep(.el-button--small) {
    height: 32px;
    padding: 7px 12px;
  }
}
@media (max-width: 640px) {
  /* 窄屏数字放在文字上面，三列各自居中 */
  .qs-steps li {
    flex-direction: column;
    text-align: center;
    gap: 4px;
    font-size: 13px;
  }
  .qs-head b {
    flex-basis: 100%;
  }
}
</style>
