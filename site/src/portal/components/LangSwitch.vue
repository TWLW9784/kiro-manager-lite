<script setup lang="ts">
/**
 * 右上角的语言切换。只有三种语言，用分段按钮而不是下拉：
 * 点一下就切，而且看不懂当前语言的人也能一眼认出「EN」「UZ」。
 */
import { LANGS, lang, setLang, tt, type Lang } from '../i18n'

// 顶栏空间有限，按钮上用短名，完整名称放在 title 里
const SHORT: Record<Lang, string> = { zh: '中文', en: 'EN', uz: 'UZ' }
</script>

<template>
  <el-radio-group
    :model-value="lang"
    size="small"
    class="lang-switch"
    :aria-label="tt('language')"
    @change="(v: string | number | boolean | undefined) => setLang(v as Lang)"
  >
    <el-radio-button v-for="l in LANGS" :key="l.code" :value="l.code" :title="l.label">
      {{ SHORT[l.code] }}
    </el-radio-button>
  </el-radio-group>
</template>

<style scoped>
.lang-switch {
  flex: none;
}
/* 三个按钮等宽，切换时不跳；高度 32px，和旁边的「使用说明」按钮对齐，
   手机上也点得准（small 尺寸默认只有 24px） */
.lang-switch :deep(.el-radio-button__inner) {
  min-width: 44px;
  padding: 9px 10px;
  font-size: 13px;
}
</style>
