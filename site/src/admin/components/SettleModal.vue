<script setup lang="ts">
/** 记一笔打款：金额、币种、网络（只 Polygon）、收款地址、交易哈希、凭证、备注 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules, type UploadFile, type UploadRawFile } from 'element-plus'
import { Paperclip } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { networkName, num, usd, validAddress, validTxHash, walletFresh } from '@site/shared/format'
import { dialogWidth, useViewport } from '@site/shared/responsive'
import { clients, loadClients, type AdminClient, type AdminOrder } from '../state'

const props = defineProps<{ order?: AdminOrder | null; clientId?: number | '' }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { width: vw } = useViewport()
const boxWidth = computed(() => dialogWidth(vw.value, 640))

const TOKENS = ['USDT', 'USDC']
const formRef = ref<FormInstance>()
const saving = ref(false)
const orders = ref<AdminOrder[]>(props.order ? [props.order] : [])
const fileList = ref<UploadFile[]>([])
const proof = ref<File | null>(null)

const leftOf = (o: AdminOrder): number => Math.max(0, num(o.due_amount) - num(o.settled_amount))
const now = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace('T', ' ')

const form = ref({
  client_id: (props.order?.client_id ?? props.clientId ?? '') as number | '',
  order_id: (props.order?.id ?? '') as number | '',
  amount: props.order ? Number(leftOf(props.order).toFixed(2)) || null : null,
  token: 'USDT',
  network: 'polygon',
  to_address: '',
  tx_hash: '',
  paid_at: now,
  note: ''
})

const client = computed<AdminClient | undefined>(() => clients.value.find((c) => c.id === form.value.client_id))
const walletUsable = computed(() => client.value?.wallet_address && client.value.wallet_network === 'polygon')

const amountHint = computed(() => {
  const o = props.order ?? orders.value.find((x) => x.id === form.value.order_id)
  if (!o) return '不挂批次时这笔只算进客户的已结总额'
  const left = leftOf(o)
  return `${o.code}：应付客户 ${usd(o.due_amount)} · 已结 ${usd(o.settled_amount)}${left > 0.004 ? ` · 还差 ${usd(left)}` : ' · 已结清'}`
})

/** 选了客户：带出收款地址（只有 Polygon 的才带），并拉他的批次 */
async function pickClient(): Promise<void> {
  const c = client.value
  if (!c) return
  form.value.token = c.wallet_token || 'USDT'
  form.value.to_address = c.wallet_network === 'polygon' ? c.wallet_address : ''
  if (props.order) return
  form.value.order_id = ''
  await guard(async () => {
    orders.value = (await api.admin<{ orders: AdminOrder[] }>('orders', { client_id: c.id, page: 1, page_size: 100 })).orders
  })
}
watch(() => form.value.client_id, pickClient)
watch(
  () => form.value.order_id,
  (id) => {
    const o = orders.value.find((x) => x.id === id)
    if (o && !form.value.amount) form.value.amount = Number(leftOf(o).toFixed(2)) || null
  }
)
onMounted(async () => {
  if (!clients.value.length) await guard(loadClients)
  await pickClient()
})

const rules: FormRules = {
  client_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
  amount: [{ required: true, message: '请填写金额', trigger: 'blur' }]
}

function beforeUpload(file: UploadRawFile): boolean {
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('凭证不能超过 5 MB')
    return false
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
    ElMessage.error('只支持 JPG / PNG / WEBP 图片或 PDF')
    return false
  }
  proof.value = file
  fileList.value = [{ uid: file.uid, name: file.name, status: 'success' } as UploadFile]
  return false
}

async function submit(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  const f = form.value
  if (f.to_address && !validAddress(f.to_address.trim())) return void ElMessage.error('收款地址格式不对')
  if (f.tx_hash && !validTxHash(f.tx_hash.trim())) return void ElMessage.error('交易哈希格式不对')
  if (!f.tx_hash.trim() && !proof.value) return void ElMessage.error('交易哈希和凭证至少填一个')
  saving.value = true
  try {
    await guard(async () => {
      const fd = new FormData()
      fd.set('client_id', String(f.client_id))
      if (f.order_id) fd.set('order_id', String(f.order_id))
      fd.set('amount', String(f.amount))
      fd.set('token', f.token)
      fd.set('network', f.network)
      fd.set('to_address', f.to_address.trim())
      fd.set('tx_hash', f.tx_hash.trim())
      fd.set('paid_at', f.paid_at)
      fd.set('note', f.note.trim())
      if (proof.value) fd.set('proof', proof.value)
      await api.form('settlement_add', fd)
      ElMessage.success('已记录打款')
      emit('saved')
      emit('close')
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="true"
    :title="props.order ? `记一笔打款 · ${props.order.code}` : '记一笔打款'"
    :width="boxWidth"
    append-to-body
    @close="emit('close')"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="客户" prop="client_id">
        <el-select v-model="form.client_id" :disabled="!!props.order" placeholder="选择客户">
          <el-option
            v-for="c in clients"
            :key="c.id"
            :value="c.id"
            :label="c.display_name || c.username"
            :disabled="!c.enabled"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="!props.order" label="批次（可不选）">
        <el-select v-model="form.order_id" clearable placeholder="不挂批次">
          <el-option
            v-for="o in orders.filter((x) => num(x.paid))"
            :key="o.id"
            :value="o.id"
            :label="`${o.code} · 应付 ${usd(o.due_amount)} · 已结 ${usd(o.settled_amount)}`"
          />
        </el-select>
      </el-form-item>
      <div class="two">
        <el-form-item label="金额" prop="amount">
          <el-input-number v-model="form.amount" :min="0.01" :precision="2" controls-position="right" class="full" />
          <div class="muted small">{{ amountHint }}</div>
        </el-form-item>
        <el-form-item label="币种">
          <el-select v-model="form.token">
            <el-option v-for="t in TOKENS" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="网络">
          <el-select v-model="form.network">
            <el-option value="polygon" label="Polygon" />
          </el-select>
        </el-form-item>
        <el-form-item label="打款时间">
          <el-input v-model="form.paid_at" placeholder="2026-10-14 15:30" />
        </el-form-item>
      </div>
      <el-form-item label="收款地址">
        <el-input v-model="form.to_address" class="mono-input" placeholder="0x…" spellcheck="false" />
        <div class="muted small">
          <template v-if="!client?.wallet_address">
            <span class="warn">客户还没填收款地址，请手动填写</span>
          </template>
          <template v-else-if="!walletUsable">
            <span class="danger">
              客户填的是 {{ networkName(client!.wallet_network) }} 地址，不能用；请让客户在门户里重填 Polygon 地址
            </span>
          </template>
          <template v-else>
            客户填的地址
            <el-tag v-if="walletFresh(client!.wallet_updated_at)" size="small" type="danger">
              24 小时内改过，先跟客户确认
            </el-tag>
          </template>
        </div>
      </el-form-item>
      <el-form-item label="交易哈希">
        <el-input v-model="form.tx_hash" class="mono-input" placeholder="0x…（Polygon 上 66 位）" spellcheck="false" />
      </el-form-item>
      <el-form-item label="付款凭证">
        <el-upload
          :file-list="fileList"
          :before-upload="beforeUpload"
          :limit="1"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          @remove="(proof = null), (fileList = [])"
        >
          <el-button v-if="!fileList.length" :icon="Paperclip">选择截图 / PDF</el-button>
        </el-upload>
        <div class="muted small">截图或 PDF，5 MB 以内。交易哈希和凭证至少给一个</div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" maxlength="255" placeholder="如：10-13 两个批次合并打款" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.full { width: 100%; }
.mono-input :deep(input) { font-family: ui-monospace, Consolas, monospace; }
@media (max-width: 760px) { .two { grid-template-columns: 1fr; } }
</style>
