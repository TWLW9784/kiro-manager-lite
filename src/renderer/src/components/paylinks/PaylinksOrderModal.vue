<script setup lang="ts">
/**
 * 派单：给客户开一个批次（档位 × 目标付款数）。按实际付款的条数结算：客户可以多次领取，
 * 已付 + 手里待付不超过目标；超时没付的自动收回换新、不占名额。池子不够时桌面端会按缺口自动提取。
 */
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { FileAddOutlined } from '@ant-design/icons-vue'
import { paylinksAdmin, type AdminClient } from '@/utils/paylinksAdmin'

const props = defineProps<{ clients: AdminClient[]; clientId?: number }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const clientId = ref<number | undefined>(props.clientId ?? props.clients.find((c) => c.enabled)?.id)
const tier = ref('pro+')
const quantity = ref(10)
const replaceLimit = ref<number | null>(null)
const note = ref('')
/** 每条结算单价；空 = 用客户的默认单价，客户也没有就按实付金额 */
const unitPrice = ref<number | null>(null)
const saving = ref(false)

async function save(): Promise<void> {
  if (!clientId.value) return void message.warning('请选择客户')
  saving.value = true
  try {
    const res = await paylinksAdmin.createOrder({
      client_id: clientId.value,
      tier: tier.value,
      quantity: Number(quantity.value),
      replace_limit: replaceLimit.value ?? undefined,
      note: note.value.trim(),
      unit_price: unitPrice.value ?? undefined
    })
    message.success(`已派单 ${res.code}，池子不够的会自动提取`)
    emit('saved')
    emit('close')
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <a-modal :open="true" width="460px" centered :footer="null" @cancel="emit('close')">
    <template #title><span class="title"><FileAddOutlined />派单</span></template>
    <a-form layout="vertical">
      <a-form-item label="客户" required>
        <a-select
          v-model:value="clientId"
          :options="props.clients.map((c) => ({ value: c.id, label: c.display_name || c.username, disabled: !c.enabled }))"
        />
      </a-form-item>
      <div class="grid">
        <a-form-item label="档位" required>
          <a-select v-model:value="tier" :options="['pro', 'pro+', 'promax', 'power'].map((v) => ({ value: v, label: v }))" />
        </a-form-item>
        <a-form-item label="目标付款数" required>
          <a-input-number v-model:value="quantity" :min="1" :max="500" :precision="0" addon-after="条" style="width: 100%" />
        </a-form-item>
      </div>
      <a-form-item label="每条结算单价（USD，可空）" extra="填了：应结 = 已付条数 × 单价；留空用客户的默认单价，客户也没设就按每条实付金额">
        <a-input-number v-model:value="unitPrice" :min="0" :max="1000" :precision="2" placeholder="如 5.00" style="width: 100%" />
      </a-form-item>
      <a-form-item label="可更换次数" extra="留空 = 和目标付款数一样多。客户点「更换」不占名额，但不能超过这个次数">
        <a-input-number v-model:value="replaceLimit" :min="0" :max="1000" :precision="0" placeholder="默认等于数量" style="width: 100%" />
      </a-form-item>
      <a-form-item label="备注（客户能看到）">
        <a-input v-model:value="note" :maxlength="255" />
      </a-form-item>
    </a-form>
    <div class="footer">
      <a-button @click="emit('close')">取消</a-button>
      <a-button type="primary" :loading="saving" @click="save">派单</a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.title { display: inline-flex; align-items: center; gap: 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
