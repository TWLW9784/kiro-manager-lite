<script setup lang="ts">
// 分配给网站客户：把导出 / 线下发出去的链接归到某个客户名下，按「已领」记、计入他的结算。
// 不分配的话，发出去的链接不会出现在网站上。
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { paylinksAdmin, type AdminClient } from '@/utils/paylinksAdmin'
import { assignLinksToClient } from '@/utils/paylinksAssign'
import { isPaidSubscription } from '@shared/paymentLink'
import type { Account } from '@shared/types'

const props = defineProps<{ accounts: Account[] }>()
const emit = defineEmits<{ close: [] }>()

const clients = ref<AdminClient[]>([])
const loading = ref(true)
const loadError = ref('')
const clientId = ref<number>()
const note = ref('')
const saving = ref(false)

const paidCount = computed(() => props.accounts.filter((a) => isPaidSubscription(a.subscription.type)).length)
const options = computed(() =>
  clients.value.map((c) => ({
    value: c.id,
    label: `${c.display_name || c.username}（${c.username}）`,
    disabled: !c.enabled
  }))
)

onMounted(async () => {
  try {
    clients.value = await paylinksAdmin.clients()
    const enabled = clients.value.filter((c) => c.enabled)
    if (enabled.length === 1) clientId.value = enabled[0].id
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

async function submit(): Promise<void> {
  const client = clients.value.find((c) => c.id === clientId.value)
  if (!client || saving.value) return
  saving.value = true
  try {
    const r = await assignLinksToClient(props.accounts, client.id, client.display_name || client.username, note.value.trim())
    const extra = r.conflicts ? `，${r.conflicts} 条网站上已归别的客户或已付款，没动` : ''
    message.success(`已分配 ${r.assigned} 条给 ${client.display_name || client.username}（批次 ${r.codes || '-'}）${extra}`)
    emit('close')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal
    :open="true"
    title="分配给网站客户"
    ok-text="分配"
    :ok-button-props="{ disabled: !clientId, loading: saving }"
    centered
    @ok="submit"
    @cancel="emit('close')"
  >
    <a-alert v-if="loadError" type="error" :message="`读取客户列表失败：${loadError}`" show-icon class="gap" />
    <p class="gap">
      共 {{ accounts.length }} 条<template v-if="paidCount">，其中 {{ paidCount }} 条本地已确认付款，网站上直接记已付</template>。
      分配后这些链接挂在这个客户名下（已领），按档位各建一个批次，计入他的结算；不会进公共池子。
    </p>
    <a-form layout="vertical">
      <a-form-item label="客户" required>
        <a-select v-model:value="clientId" :options="options" :loading="loading" placeholder="选择网站客户" />
      </a-form-item>
      <a-form-item label="批次备注">
        <a-input v-model:value="note" :maxlength="255" placeholder="如：10-14 用 TXT 发出的 20 条" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.gap { margin-bottom: 12px; }
</style>
