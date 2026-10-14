<script setup lang="ts">
/** 新建 / 编辑客户。改密码或停用会让该客户已登录的页面立即失效 */
import { computed, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { CopyDocument, Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { copyText, networkName, num, validAddress } from '@site/shared/format'
import { dialogTop, dialogWidth, useViewport } from '@site/shared/responsive'
import type { AdminClient } from '../state'

const props = defineProps<{ client: AdminClient | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { width: vw } = useViewport()
const boxWidth = computed(() => dialogWidth(vw.value, 620))
const boxTop = computed(() => dialogTop(vw.value))

const TIMEOUTS = [
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '24 小时（推荐）' },
  { value: 2880, label: '48 小时' },
  { value: 4320, label: '3 天' },
  { value: 10080, label: '7 天（太长，链接容易过期）' }
]
const TOKENS = ['USDT', 'USDC']

function randomPassword(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => chars[b % chars.length]).join('')
}

const editing = computed(() => !!props.client)
const c = props.client
/** 以前填的不是 Polygon：地址不带出来，要重填 */
const oldNetwork = c?.wallet_address && c.wallet_network !== 'polygon' ? c.wallet_network : ''
const formRef = ref<FormInstance>()
const saving = ref(false)
const savedInfo = ref('')
const form = ref({
  username: c?.username ?? '',
  display_name: c?.display_name ?? '',
  password: c ? '' : randomPassword(),
  enabled: c ? !!c.enabled : true,
  max_claim: c?.max_claim ?? 50,
  claim_timeout_minutes: c?.claim_timeout_minutes ?? 1440,
  unit_price: c?.unit_price != null ? num(c.unit_price) : (null as number | null),
  note: c?.note ?? '',
  wallet_token: c?.wallet_token || 'USDT',
  wallet_address: c?.wallet_network === 'polygon' ? (c?.wallet_address ?? '') : ''
})
if (!TIMEOUTS.some((t) => t.value === form.value.claim_timeout_minutes)) {
  TIMEOUTS.unshift({ value: form.value.claim_timeout_minutes, label: `${form.value.claim_timeout_minutes} 分钟` })
}

const rules = computed<FormRules>(() => ({
  username: [
    { required: true, message: '请填登录账号', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: '只能用 3-32 位字母、数字、_ . -', trigger: 'blur' }
  ],
  password: editing.value
    ? [{ min: 8, message: '密码至少 8 位', trigger: 'blur' }]
    : [{ required: true, message: '请设置密码', trigger: 'blur' }, { min: 8, message: '密码至少 8 位', trigger: 'blur' }],
  wallet_address: [
    {
      validator: (_r, v: string, cb: (e?: Error) => void) =>
        !v || validAddress(String(v).trim()) ? cb() : cb(new Error('地址格式不对（Polygon 上是 0x + 40 位）')),
      trigger: 'blur'
    }
  ]
}))

async function save(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    await guard(async () => {
      const f = form.value
      await api.admin('client_save', {
        id: props.client?.id,
        username: f.username.trim(),
        password: f.password || undefined,
        display_name: f.display_name.trim(),
        enabled: f.enabled,
        max_claim: f.max_claim,
        claim_timeout_minutes: f.claim_timeout_minutes,
        note: f.note.trim(),
        unit_price: f.unit_price ?? '',
        wallet_network: 'polygon',
        wallet_token: f.wallet_token,
        wallet_address: f.wallet_address.trim()
      })
      emit('saved')
      if (f.password) {
        savedInfo.value = `网址：${location.origin}/\n账号：${f.username.trim()}\n密码：${f.password}`
        ElMessage.success(editing.value ? '已保存，新密码已生效' : '客户已创建')
      } else {
        ElMessage.success('已保存')
        emit('close')
      }
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="true"
    :title="editing ? `编辑客户 · ${props.client?.username}` : '新建客户'"
    :width="boxWidth" :top="boxTop"
    append-to-body
    @close="emit('close')"
  >
    <template v-if="!savedInfo">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <div class="two">
          <el-form-item label="登录账号" prop="username">
            <el-input v-model="form.username" placeholder="字母、数字、_ . -" maxlength="32" />
          </el-form-item>
          <el-form-item label="显示名称">
            <el-input v-model="form.display_name" placeholder="客户页显示，可留空" maxlength="64" />
          </el-form-item>
        </div>
        <el-form-item :label="editing ? '新密码（留空不改）' : '密码'" prop="password">
          <el-input v-model="form.password" :placeholder="editing ? '不改就留空' : '至少 8 位'">
            <template #append><el-button :icon="Refresh" @click="form.password = randomPassword()" /></template>
          </el-input>
        </el-form-item>
        <div class="two">
          <el-form-item label="单次最多领取">
            <el-input-number v-model="form.max_claim" :min="1" :max="500" controls-position="right" class="full" />
          </el-form-item>
          <el-form-item label="领走未付多久收回">
            <el-select v-model="form.claim_timeout_minutes">
              <el-option v-for="t in TIMEOUTS" :key="t.value" :value="t.value" :label="t.label" />
            </el-select>
            <div class="muted small">
              {{
                form.claim_timeout_minutes > 2880
                  ? '时间太长：链接放久了 Stripe 可能失效，建议 24 小时'
                  : '客户在网站上领走后这么久没付，自动作废换新。线下发出的批次不受限制'
              }}
            </div>
          </el-form-item>
        </div>
        <div class="two">
          <el-form-item label="默认每条结算单价（USD，可空）">
            <el-input-number v-model="form.unit_price" :min="0" :max="1000" :precision="2" placeholder="空 = 按客户实付" class="full" />
          </el-form-item>
          <el-form-item label="备注（只有你能看到）">
            <el-input v-model="form.note" maxlength="255" />
          </el-form-item>
        </div>

        <el-divider content-position="left">
          <span class="small">收款地址（只支持 Polygon；客户一般自己填，这里可代填）</span>
        </el-divider>
        <el-alert
          v-if="oldNetwork"
          type="warning"
          show-icon
          :closable="false"
          class="gap"
          :title="`客户原来填的是 ${networkName(oldNetwork)} 地址，现在只支持 Polygon，需要重填`"
        />
        <div class="two">
          <el-form-item label="网络">
            <el-select model-value="polygon" disabled>
              <el-option value="polygon" label="Polygon" />
            </el-select>
          </el-form-item>
          <el-form-item label="币种">
            <el-select v-model="form.wallet_token">
              <el-option v-for="t in TOKENS" :key="t" :value="t" :label="t" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="地址" prop="wallet_address">
          <el-input v-model="form.wallet_address" class="mono-input" placeholder="0x…" spellcheck="false" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="form.enabled">启用（停用后客户立即被登出、不能再登录）</el-checkbox>
        </el-form-item>
      </el-form>
    </template>

    <template v-else>
      <el-alert
        type="success"
        show-icon
        :closable="false"
        title="把下面的登录信息发给客户"
        description="密码只在这里显示这一次，网站上存的是加密后的，找回不了。"
      />
      <pre class="info">{{ savedInfo }}</pre>
    </template>

    <template #footer>
      <template v-if="!savedInfo">
        <el-button @click="emit('close')">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
      <template v-else>
        <el-button @click="emit('close')">完成</el-button>
        <el-button type="primary" :icon="CopyDocument" @click="copyText(savedInfo), ElMessage.success('登录信息已复制')">
          复制登录信息
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.full { width: 100%; }
.gap { margin-bottom: 12px; }
.mono-input :deep(input) { font-family: ui-monospace, Consolas, monospace; }
.info {
  margin: 12px 0 0;
  padding: 12px 14px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
  font-family: ui-monospace, Consolas, monospace;
  white-space: pre-wrap;
  user-select: all;
}
@media (max-width: 760px) { .two { grid-template-columns: 1fr; } }
</style>
