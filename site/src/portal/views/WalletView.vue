<script setup lang="ts">
/** 收款设置：只支持 Polygon；改地址要输当前密码 */
import { computed, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { copyText, validAddress } from '@site/shared/format'
import { t, tt } from '../i18n'
import { loadMe, me, walletIssue } from '../state'

const formRef = ref<FormInstance>()
const saving = ref(false)
const form = ref({ network: 'polygon', token: 'USDT', address: '', password: '' })

watch(
  me,
  (v) => {
    if (!v) return
    form.value.network = v.client.wallet_network_ok ? v.client.wallet_network : 'polygon'
    form.value.token = v.client.wallet_token || 'USDT'
    // 以前填的不是 Polygon：地址不带出来，要客户重填
    form.value.address = v.client.wallet_network_ok ? v.client.wallet_address : ''
  },
  { immediate: true }
)

const rules = computed<FormRules>(() => ({
  address: [
    { required: true, message: t('err_bad_address'), trigger: 'blur' },
    {
      validator: (_r, value: string, cb: (e?: Error) => void) =>
        validAddress(String(value).trim()) ? cb() : cb(new Error(t('err_bad_address'))),
      trigger: ['blur', 'change']
    }
  ],
  password: [{ required: true, message: t('wallet_password_hint'), trigger: 'blur' }]
}))

async function save(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    await guard(async () => {
      await api.post('wallet_save', {
        network: form.value.network,
        token: form.value.token,
        address: form.value.address.trim(),
        password: form.value.password
      })
      ElMessage.success(t('wallet_saved'))
      form.value.password = ''
      await loadMe()
    })
  } finally {
    saving.value = false
  }
}

async function copyAddr(): Promise<void> {
  await copyText(me.value?.client.wallet_address ?? '')
  ElMessage.success(t('copied', { n: 1 }))
}
</script>

<template>
  <el-alert
    v-if="walletIssue === 'network'"
    type="error"
    show-icon
    :closable="false"
    :title="tt('wallet_wrong_network', { name: me?.client.wallet_network_name ?? '' })"
    :description="tt('wallet_wrong_network_tip')"
  />

  <div class="grid">
    <el-card shadow="never">
      <template #header><h2 class="head">{{ tt('wallet_title') }}</h2></template>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <div class="two">
          <el-form-item :label="tt('wallet_network')">
            <el-select v-model="form.network">
              <el-option v-for="n in me?.networks ?? []" :key="n.id" :value="n.id" :label="n.name" />
            </el-select>
            <div class="muted small">{{ tt('polygon_only') }}</div>
          </el-form-item>
          <el-form-item :label="tt('wallet_token')">
            <el-select v-model="form.token">
              <el-option v-for="k in me?.tokens ?? []" :key="k" :value="k" :label="k" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item :label="tt('wallet_address')" prop="address">
          <el-input v-model="form.address" class="mono-input" placeholder="0x…" spellcheck="false" autocomplete="off" />
          <div class="muted small">{{ tt('wallet_address_hint') }}</div>
        </el-form-item>
        <el-form-item :label="tt('wallet_password')" prop="password">
          <el-input v-model="form.password" type="password" show-password autocomplete="current-password" />
          <div class="muted small">{{ tt('wallet_password_hint') }}</div>
        </el-form-item>
        <el-button type="primary" :loading="saving" @click="save">{{ tt('save') }}</el-button>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header><h2 class="head">{{ tt('wallet_current') }}</h2></template>
      <el-descriptions v-if="me?.client.wallet_address" :column="1" border size="small">
        <el-descriptions-item :label="tt('wallet_network')">{{ me.client.wallet_network_name }}</el-descriptions-item>
        <el-descriptions-item :label="tt('wallet_token')">{{ me.client.wallet_token }}</el-descriptions-item>
        <el-descriptions-item :label="tt('wallet_address')">
          <span class="mono">{{ me.client.wallet_address }}</span>
          <el-button text :icon="CopyDocument" size="small" @click="copyAddr" />
        </el-descriptions-item>
        <el-descriptions-item :label="tt('wallet_updated')">{{ me.client.wallet_updated_at ?? '-' }}</el-descriptions-item>
      </el-descriptions>
      <el-empty v-else :description="`${tt('wallet_missing')}｜${tt('wallet_missing_tip')}`" />
      <el-alert type="warning" :closable="false" show-icon class="note" :title="tt('wallet_warning')" />
    </el-card>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; }
.head { margin: 0; font-size: 15px; font-weight: 600; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.note { margin-top: 14px; }
.mono-input :deep(input) { font-family: ui-monospace, Consolas, monospace; }
@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
</style>
