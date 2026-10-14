<script setup lang="ts">
/**
 * 记一笔打款：给客户转完虚拟币（默认 Polygon · USDT）后记下来。
 * 收款地址默认带出客户在门户里填的；交易哈希和凭证（截图 / PDF）至少给一个；挂到批次上会自动累加批次的已结金额。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { message, type UploadFile } from 'ant-design-vue'
import { PaperClipOutlined } from '@ant-design/icons-vue'
import dayjs, { type Dayjs } from 'dayjs'
import {
  NETWORKS,
  TOKENS,
  addSettlement,
  networkName,
  paylinksAdmin,
  validAddress,
  validTxHash,
  walletFresh,
  type AdminClient,
  type AdminOrder
} from '@/utils/paylinksAdmin'

const props = defineProps<{ clients: AdminClient[]; clientId?: number; order?: AdminOrder | null }>()
const emit = defineEmits<{ saved: []; close: [] }>()

const n = (v: string | number | null | undefined): number => Number(v ?? 0)
const leftOf = (o: AdminOrder): number => Math.max(0, n(o.due_amount) - n(o.settled_amount))

const clientId = ref<number | undefined>(props.order?.client_id ?? props.clientId)
const orderId = ref<number | undefined>(props.order?.id)
const amount = ref<number | null>(props.order ? Number(leftOf(props.order).toFixed(2)) || null : null)
const token = ref<string>('USDT')
const network = ref<string>('polygon')
const address = ref('')
const txHash = ref('')
const paidAt = ref<Dayjs>(dayjs())
const note = ref('')
const file = ref<File | null>(null)
const saving = ref(false)
const orders = ref<AdminOrder[]>(props.order ? [props.order] : [])

const client = computed(() => props.clients.find((c) => c.id === clientId.value))
const clientOptions = computed(() => props.clients.map((c) => ({ value: c.id, label: c.display_name || c.username })))
const orderOptions = computed(() =>
  orders.value
    .filter((o) => n(o.paid) > 0)
    .map((o) => ({ value: o.id, label: `${o.code} · 应结 $${n(o.due_amount).toFixed(2)} · 已结 $${n(o.settled_amount).toFixed(2)}` }))
)
const addressOk = computed(() => !address.value || validAddress(network.value, address.value.trim()))
const amountHint = computed(() => {
  const o = props.order ?? orders.value.find((x) => x.id === orderId.value)
  if (!o) return '不挂批次时这笔只算进客户的已结总额'
  const left = leftOf(o)
  return `${o.code}：应付客户 $${n(o.due_amount).toFixed(2)} · 已结 $${n(o.settled_amount).toFixed(2)}${left > 0.004 ? ` · 还差 $${left.toFixed(2)}` : ' · 已结清'}`
})
const txOk = computed(() => !txHash.value || validTxHash(network.value, txHash.value.trim()))

/** 选了客户：带出他的收款地址 / 网络 / 币种，并拉他的批次 */
async function pickClient(): Promise<void> {
  const c = client.value
  if (!c) return
  // 只走 Polygon：客户以前填的是别的网络时不带出地址（同一串地址换网络可能收不到）
  network.value = 'polygon'
  token.value = c.wallet_token || 'USDT'
  address.value = c.wallet_network === 'polygon' ? c.wallet_address || '' : ''
  if (props.order) return
  orderId.value = undefined
  try {
    orders.value = (await paylinksAdmin.ordersPage({ client_id: c.id, page: 1, page_size: 100 })).orders
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}
watch(clientId, pickClient)
watch(orderId, (id) => {
  const o = orders.value.find((x) => x.id === id)
  if (o && !amount.value) amount.value = Number(leftOf(o).toFixed(2)) || null
})
onMounted(pickClient)

/** a-upload 只用来选文件，不自己上传：返回 false 阻止默认上传，文件交给 addSettlement */
const fileList = ref<UploadFile[]>([])
function beforeUpload(f: File): boolean {
  if (f.size > 5 * 1024 * 1024) {
    message.error('凭证不能超过 5 MB')
    return false
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type)) {
    message.error('只支持 JPG / PNG / WEBP 图片或 PDF')
    return false
  }
  file.value = f
  fileList.value = [{ uid: '1', name: f.name, status: 'done' } as UploadFile]
  return false
}
function dropFile(): void {
  file.value = null
  fileList.value = []
}

async function submit(): Promise<void> {
  if (!clientId.value) return void message.error('请选择客户')
  if (!amount.value || amount.value <= 0) return void message.error('请填写金额')
  if (!addressOk.value) return void message.error('收款地址和网络对不上')
  if (!txOk.value) return void message.error('交易哈希格式不对')
  if (!txHash.value.trim() && !file.value) return void message.error('交易哈希和凭证至少填一个')
  saving.value = true
  try {
    await addSettlement(
      {
        client_id: clientId.value,
        order_id: orderId.value ?? null,
        amount: amount.value,
        token: token.value,
        network: network.value,
        to_address: address.value.trim(),
        tx_hash: txHash.value.trim(),
        paid_at: paidAt.value.format('YYYY-MM-DD HH:mm'),
        note: note.value.trim()
      },
      file.value
    )
    message.success('已记录打款')
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
  <a-modal
    :open="true"
    :title="order ? `记一笔打款 · ${order.code}` : '记一笔打款'"
    width="640px"
    ok-text="保存"
    :confirm-loading="saving"
    centered
    @ok="submit"
    @cancel="emit('close')"
  >
    <a-form layout="vertical" class="form">
      <a-form-item label="客户" required class="span-2">
        <a-select v-model:value="clientId" :options="clientOptions" :disabled="!!order" placeholder="选择客户" />
      </a-form-item>
      <a-form-item v-if="!order" label="批次（可不选）" class="span-2">
        <a-select v-model:value="orderId" :options="orderOptions" allow-clear placeholder="不挂批次" />
      </a-form-item>
      <a-form-item label="金额" required :extra="amountHint">
        <a-input-number v-model:value="amount" :min="0.01" :step="1" :precision="2" style="width: 100%" />
      </a-form-item>
      <a-form-item label="币种">
        <a-select v-model:value="token" :options="TOKENS.map((t) => ({ value: t, label: t }))" />
      </a-form-item>
      <a-form-item label="网络">
        <a-select v-model:value="network" :options="NETWORKS.map((x) => ({ value: x.id, label: x.name }))" />
      </a-form-item>
      <a-form-item label="打款时间">
        <a-date-picker v-model:value="paidAt" show-time format="YYYY-MM-DD HH:mm" style="width: 100%" :allow-clear="false" />
      </a-form-item>
      <a-form-item label="收款地址" class="span-2" :validate-status="addressOk ? '' : 'error'" :help="addressOk ? undefined : '地址和网络对不上'">
        <a-input v-model:value="address" class="mono" placeholder="0x…" />
        <div class="small hint">
          <span v-if="client?.wallet_address && client.wallet_network !== 'polygon'" class="danger">
            客户填的是 {{ networkName(client.wallet_network) }} 地址，不能用；请让客户在门户里重填 Polygon 地址
          </span>
          <template v-else-if="client?.wallet_address">
            客户填的地址
            <a-tag v-if="walletFresh(client.wallet_updated_at)" color="red" :bordered="false">24 小时内改过，先跟客户确认</a-tag>
          </template>
          <span v-else-if="client" class="warn">客户还没填收款地址，请手动填写</span>
        </div>
      </a-form-item>
      <a-form-item label="交易哈希" class="span-2" :validate-status="txOk ? '' : 'error'" :help="txOk ? undefined : '交易哈希格式不对'">
        <a-input v-model:value="txHash" class="mono" placeholder="0x…（Polygon 上 66 位）" />
      </a-form-item>
      <a-form-item label="付款凭证" class="span-2" extra="截图或 PDF，5 MB 以内。交易哈希和凭证至少给一个">
        <a-upload
          :file-list="fileList"
          :before-upload="beforeUpload"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          list-type="text"
          :max-count="1"
          @remove="dropFile"
        >
          <a-button v-if="!fileList.length">
            <template #icon><PaperClipOutlined /></template>
            选择截图 / PDF
          </a-button>
        </a-upload>
      </a-form-item>
      <a-form-item label="备注" class="span-2">
        <a-input v-model:value="note" :maxlength="255" placeholder="如：10-13 两个批次合并打款" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped>
.form { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; }
.form :deep(.ant-form-item) { margin-bottom: 12px; }
.span-2 { grid-column: span 2; }
.mono :deep(input), .mono { font-family: ui-monospace, Consolas, monospace; }
.small { font-size: 12px; }
.hint { margin-top: 4px; color: var(--kal-muted); }
.warn { color: #faad14; }
.danger { color: #ff4d4f; }
</style>
