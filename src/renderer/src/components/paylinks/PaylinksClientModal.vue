<script setup lang="ts">
/**
 * 新建 / 编辑网站客户。改密码或停用会让该客户已登录的页面立即失效。
 * 保存后把账号密码组合好给出复制按钮，直接发给客户。
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { CopyOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons-vue'
import { copyText } from '@/utils/ui'
import { NETWORKS, TOKENS, networkName, paylinksAdmin, randomPassword, validAddress, type AdminClient } from '@/utils/paylinksAdmin'

const props = defineProps<{ client: AdminClient | null; siteUrl: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const editing = computed(() => !!props.client)
const username = ref(props.client?.username ?? '')
const displayName = ref(props.client?.display_name ?? '')
const password = ref(props.client ? '' : randomPassword())
const enabled = ref(props.client ? !!props.client.enabled : true)
const maxClaim = ref(props.client?.max_claim ?? 50)
const TIMEOUTS = [
  { value: 180, label: '3 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
  { value: 4320, label: '3 天' },
  { value: 10080, label: '7 天' }
]
const timeout = ref(props.client?.claim_timeout_minutes ?? 180)
// 老数据可能是任意分钟数，补进选项里，免得下拉显示空白
if (!TIMEOUTS.some((t) => t.value === timeout.value)) {
  TIMEOUTS.unshift({ value: timeout.value, label: `${timeout.value} 分钟` })
}
const timeoutText = computed(() =>
  timeout.value >= 1440 ? '线下用文件发链接的客户建议 7 天，免得链接被自动换掉' : '客户领走后这么久没付，自动收回换新链接'
)
const note = ref(props.client?.note ?? '')
// 收款地址：客户自己在门户里填（要输密码）；客户在群里发过来时可以代填
// 只支持 Polygon：以前填的是别的网络时地址不带出来，要客户重填
const walletNetwork = ref('polygon')
const walletToken = ref(props.client?.wallet_token || 'USDT')
const walletAddress = ref(props.client?.wallet_network === 'polygon' ? props.client?.wallet_address ?? '' : '')
const oldNetwork = props.client?.wallet_address && props.client.wallet_network !== 'polygon' ? props.client.wallet_network : ''
/** 新批次默认的每条结算单价；空 = 按实付金额 */
const unitPrice = ref<number | null>(props.client?.unit_price != null ? Number(props.client.unit_price) : null)
const addressOk = computed(() => !walletAddress.value.trim() || validAddress(walletNetwork.value, walletAddress.value.trim()))
const saving = ref(false)
/** 保存成功后显示可复制的登录信息 */
const savedInfo = ref('')

async function save(): Promise<void> {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username.value.trim())) {
    return void message.warning('账号只能用 3-32 位字母、数字、_ . -')
  }
  if (!editing.value && password.value.length < 8) return void message.warning('密码至少 8 位')
  if (editing.value && password.value && password.value.length < 8) return void message.warning('密码至少 8 位')
  if (!addressOk.value) return void message.warning('收款地址和网络对不上')
  saving.value = true
  try {
    await paylinksAdmin.saveClient({
      id: props.client?.id,
      username: username.value.trim(),
      password: password.value || undefined,
      display_name: displayName.value.trim(),
      enabled: enabled.value,
      max_claim: Number(maxClaim.value) || 50,
      claim_timeout_minutes: Number(timeout.value) || 180,
      note: note.value.trim(),
      wallet_network: walletNetwork.value,
      wallet_token: walletToken.value,
      wallet_address: walletAddress.value.trim(),
      unit_price: unitPrice.value ?? ''
    })
    emit('saved')
    if (password.value) {
      savedInfo.value = `网址：${props.siteUrl}\n账号：${username.value.trim()}\n密码：${password.value}`
      message.success(editing.value ? '已保存，新密码已生效' : '客户已创建')
    } else {
      message.success('已保存')
      emit('close')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal :open="true" width="520px" centered :footer="null" @cancel="emit('close')">
    <template #title>
      <span class="title"><UserOutlined />{{ editing ? `编辑客户 · ${props.client?.username}` : '新建客户' }}</span>
    </template>

    <template v-if="!savedInfo">
      <a-form layout="vertical">
        <div class="grid">
          <a-form-item label="登录账号" required>
            <a-input v-model:value="username" placeholder="字母、数字、_ . -" :maxlength="32" />
          </a-form-item>
          <a-form-item label="显示名称">
            <a-input v-model:value="displayName" placeholder="网页右上角显示，可留空" :maxlength="64" />
          </a-form-item>
        </div>
        <a-form-item :label="editing ? '新密码（留空不改）' : '密码'" :required="!editing">
          <a-input v-model:value="password" :placeholder="editing ? '不改就留空' : '至少 8 位'">
            <template #suffix>
              <a-tooltip title="随机生成">
                <ReloadOutlined class="gen" @click="password = randomPassword()" />
              </a-tooltip>
            </template>
          </a-input>
        </a-form-item>
        <div class="grid">
          <a-form-item label="单次最多领取">
            <a-input-number v-model:value="maxClaim" :min="1" :max="500" :precision="0" addon-after="条" style="width: 100%" />
          </a-form-item>
          <a-form-item label="领走未付多久收回" :extra="timeoutText">
            <a-select v-model:value="timeout" :options="TIMEOUTS" />
          </a-form-item>
        </div>
        <a-form-item label="默认每条结算单价（USD，可空）" extra="派单时没填单价就用这个；留空 = 按每条实付金额结算">
          <a-input-number v-model:value="unitPrice" :min="0" :max="1000" :precision="2" placeholder="如 5.00" style="width: 100%" />
        </a-form-item>
        <a-divider orientation="left" plain class="divider">收款地址（只支持 Polygon；客户一般自己填，这里可代填）</a-divider>
        <a-alert v-if="oldNetwork" type="warning" show-icon class="divider" :message="`客户原来填的是 ${networkName(oldNetwork)} 地址，现在只支持 Polygon，需要重填`" />
        <div class="grid">
          <a-form-item label="网络">
            <a-select v-model:value="walletNetwork" :options="NETWORKS.map((x) => ({ value: x.id, label: x.name }))" />
          </a-form-item>
          <a-form-item label="币种">
            <a-select v-model:value="walletToken" :options="TOKENS.map((x) => ({ value: x, label: x }))" />
          </a-form-item>
        </div>
        <a-form-item label="地址" :validate-status="addressOk ? '' : 'error'" :help="addressOk ? undefined : '地址和网络对不上'">
          <a-input v-model:value="walletAddress" class="mono" placeholder="0x…" />
        </a-form-item>
        <a-form-item label="备注（只有你能看到）">
          <a-input v-model:value="note" :maxlength="255" />
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="enabled">启用（停用后客户立即被登出、不能再登录）</a-checkbox>
        </a-form-item>
      </a-form>
      <div class="footer">
        <a-button @click="emit('close')">取消</a-button>
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
      </div>
    </template>

    <template v-else>
      <a-alert type="success" show-icon message="把下面的登录信息发给客户。密码只在这里显示这一次，网站上存的是加密后的，找回不了。" />
      <pre class="info">{{ savedInfo }}</pre>
      <div class="footer">
        <a-button @click="emit('close')">完成</a-button>
        <a-button type="primary" @click="copyText(savedInfo, '登录信息已复制')">
          <template #icon><CopyOutlined /></template>
          复制登录信息
        </a-button>
      </div>
    </template>
  </a-modal>
</template>

<style scoped>
.title { display: inline-flex; align-items: center; gap: 8px; }
.divider { margin: 4px 0 10px; font-size: 12px; }
.mono :deep(input), .mono { font-family: ui-monospace, Consolas, monospace; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.gen { cursor: pointer; color: var(--kal-muted); }
.gen:hover { color: var(--kal-primary); }
.info {
  margin: 12px 0 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--kal-block-bg);
  font-family: ui-monospace, Consolas, monospace;
  white-space: pre-wrap;
  user-select: all;
}
.footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
