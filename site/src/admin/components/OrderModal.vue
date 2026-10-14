<script setup lang="ts">
/** 派单：给客户开一个批次（档位 × 目标付款数），可设每条结算单价与更换次数 */
import { computed, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { api, guard } from '@site/shared/api'
import { dialogTop, dialogWidth, useViewport } from '@site/shared/responsive'
import { clients } from '../state'

const props = defineProps<{ clientId?: number }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { width: vw } = useViewport()
const boxWidth = computed(() => dialogWidth(vw.value, 560))
const boxTop = computed(() => dialogTop(vw.value))

const TIERS = ['pro', 'pro+', 'promax', 'power']
const formRef = ref<FormInstance>()
const saving = ref(false)
const form = ref({
  client_id: props.clientId ?? clients.value.find((c) => c.enabled)?.id ?? ('' as number | ''),
  tier: 'pro+',
  quantity: 10,
  unit_price: null as number | null,
  replace_limit: null as number | null,
  note: ''
})
const rules: FormRules = {
  client_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
  quantity: [{ required: true, message: '请填目标付款数', trigger: 'blur' }]
}

async function submit(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    await guard(async () => {
      const body: Record<string, unknown> = {
        client_id: form.value.client_id,
        tier: form.value.tier,
        quantity: form.value.quantity,
        note: form.value.note.trim()
      }
      if (form.value.unit_price != null) body.unit_price = form.value.unit_price
      if (form.value.replace_limit != null) body.replace_limit = form.value.replace_limit
      const r = await api.admin<{ code: string }>('order_create', body)
      ElMessage.success(`已派单 ${r.code}，池子不够的会自动提取`)
      emit('saved')
      emit('close')
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="true" title="派单" :width="boxWidth" :top="boxTop" append-to-body @close="emit('close')">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="客户" prop="client_id">
        <el-select v-model="form.client_id" placeholder="选择客户">
          <el-option
            v-for="c in clients"
            :key="c.id"
            :value="c.id"
            :label="c.display_name || c.username"
            :disabled="!c.enabled"
          />
        </el-select>
      </el-form-item>
      <div class="two">
        <el-form-item label="档位">
          <el-select v-model="form.tier">
            <el-option v-for="t in TIERS" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标付款数" prop="quantity">
          <el-input-number v-model="form.quantity" :min="1" :max="500" controls-position="right" class="full" />
        </el-form-item>
        <el-form-item label="每条结算单价（USD，可空）">
          <el-input-number v-model="form.unit_price" :min="0" :max="1000" :precision="2" placeholder="空 = 客户默认" class="full" />
        </el-form-item>
        <el-form-item label="可更换次数（可空）">
          <el-input-number v-model="form.replace_limit" :min="0" :max="1000" placeholder="空 = 和目标一样" class="full" />
        </el-form-item>
      </div>
      <el-form-item label="备注（客户能看到）">
        <el-input v-model="form.note" maxlength="255" />
      </el-form-item>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="按实际付款的条数结算"
        description="客户可以多次领取，已付 + 手里待付不超过目标；超过领取时限没付的自动收回换新、不占名额。池子不够时开着的桌面端会自动提取。"
      />
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">派单</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.full { width: 100%; }
@media (max-width: 760px) { .two { grid-template-columns: 1fr; } }
</style>
