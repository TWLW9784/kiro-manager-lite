<script setup lang="ts">
/**
 * 派单并付款。工作流是「先付款给客户 → 派批次 → 客户在门户里完成」，
 * 所以派单时就把这笔钱一起记上，不用再去批次详情里另记一笔。
 * 交易哈希、凭证都选填。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules, type UploadFile, type UploadRawFile } from 'element-plus'
import { Paperclip } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { TIERS, num, usd, validTxHash, walletFresh } from '@site/shared/format'
import { dialogTop, dialogWidth, useViewport } from '@site/shared/responsive'
import { clients, overview } from '../state'

const props = defineProps<{ clientId?: number }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { width: vw } = useViewport()
const boxWidth = computed(() => dialogWidth(vw.value, 560))
const boxTop = computed(() => dialogTop(vw.value))

/** 池子里每个档位现在有几条可领的；派单时看得到，不用派完才发现缺货 */
const available = computed(() => {
  const out: Record<string, number> = {}
  for (const r of overview.value?.by_status ?? []) if (r.status === 'available') out[r.tier] = (out[r.tier] ?? 0) + num(r.n)
  return out
})
const short = computed(() => Math.max(0, form.value.quantity - (available.value[form.value.tier] ?? 0)))
const formRef = ref<FormInstance>()
const saving = ref(false)
const form = ref({
  client_id: props.clientId ?? clients.value.find((c) => c.enabled)?.id ?? ('' as number | ''),
  tier: 'pro+',
  quantity: 10,
  unit_price: null as number | null,
  replace_limit: null as number | null,
  note: '',
  // 付款部分
  paid: true,
  amount: null as number | null,
  tx_hash: '',
  pay_note: ''
})
const proof = ref<UploadRawFile | null>(null)
const fileList = ref<UploadFile[]>([])
const more = ref<string[]>([])

const client = computed(() => clients.value.find((c) => c.id === form.value.client_id))

// 选客户时带出他的默认单价
watch(
  () => form.value.client_id,
  () => {
    const p = client.value?.unit_price
    form.value.unit_price = p === null || p === undefined ? null : num(p)
  },
  { immediate: true }
)

/** 这批应付客户的钱 = 目标数 × 单价；没设单价时没法预先算（按客户实付结） */
const due = computed(() =>
  form.value.unit_price === null ? null : Math.round(form.value.quantity * form.value.unit_price * 100) / 100
)
// 金额跟着应付走：只要金额还等于上一次的应付（没被手动改过），应付变了就跟着变。
// 不靠「用户有没有输入过」的标记：步进按钮只发 change、不发 input，标记会漏
watch(
  due,
  (d, prev) => {
    const a = form.value.amount
    if (a === null || prev === undefined || Math.abs(num(a) - num(prev)) < 0.005) form.value.amount = d
  },
  { immediate: true }
)

/** 客户当前余额：正 = 他手里有你预付的钱，负 = 你还欠他 */
const balanceText = computed(() => {
  const b = num(client.value?.balance)
  if (!client.value) return ''
  if (Math.abs(b) < 0.005) return '和他已经结清'
  return b > 0 ? `他手里还有你预付的 ${usd(b)}` : `你目前还欠他 ${usd(-b)}`
})
const walletWarn = computed(() => {
  const c = client.value
  if (!c) return ''
  if (!c.wallet_address) return '他还没填收款地址'
  if (c.wallet_network !== 'polygon') return '他填的不是 Polygon 地址，别往这个地址打款'
  if (walletFresh(c.wallet_updated_at)) return '他的收款地址 24 小时内改过，打款前先跟他确认'
  return ''
})

const rules: FormRules = {
  client_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
  quantity: [{ required: true, message: '请填目标付款数', trigger: 'blur' }]
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
  if (f.paid && !(num(f.amount) > 0)) return void ElMessage.error('请填打款金额，或者关掉「我已经付了」')
  if (f.paid && f.tx_hash.trim() && !validTxHash(f.tx_hash.trim())) return void ElMessage.error('交易哈希格式不对')
  saving.value = true
  try {
    await guard(async () => {
      const body: Record<string, unknown> = {
        client_id: f.client_id,
        tier: f.tier,
        quantity: f.quantity,
        note: f.note.trim()
      }
      if (f.unit_price != null) body.unit_price = f.unit_price
      if (f.replace_limit != null) body.replace_limit = f.replace_limit
      const order = await api.admin<{ id: number; code: string }>('order_create', body)

      if (f.paid) {
        // 第二步记钱。凭证是文件，得走表单上传，所以分两步；
        // 这一步失败时批次已经建好了，提示去批次里补记，别让人以为派单失败
        try {
          const fd = new FormData()
          fd.set('client_id', String(f.client_id))
          fd.set('order_id', String(order.id))
          fd.set('amount', String(f.amount))
          fd.set('tx_hash', f.tx_hash.trim())
          fd.set('note', f.pay_note.trim())
          if (proof.value) fd.set('proof', proof.value)
          await api.form('settlement_add', fd)
          ElMessage.success(`已派单 ${order.code}，并记下打款 ${usd(f.amount)}`)
        } catch (e) {
          ElMessage.warning({
            message: `批次 ${order.code} 已建好，但打款没记上：${e instanceof Error ? e.message : String(e)}。请在批次详情里补记。`,
            duration: 8000
          })
        }
      } else {
        ElMessage.success(`已派单 ${order.code}`)
      }
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
        <div v-if="balanceText" class="hint" :class="{ warn: num(client?.balance) < -0.004 }">{{ balanceText }}</div>
      </el-form-item>

      <div class="two">
        <el-form-item label="档位">
          <el-select v-model="form.tier">
            <el-option v-for="t in TIERS" :key="t" :value="t" :label="`${t}（池子里 ${available[t] ?? 0} 条）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量（要完成几个）" prop="quantity">
          <el-input-number v-model="form.quantity" :min="1" :max="500" controls-position="right" class="full" />
          <div v-if="short" class="hint warn">池子里少 {{ short }} 条，开着的桌面端会自动提取补上</div>
        </el-form-item>
      </div>
      <el-form-item label="每个多少钱（USD）">
        <el-input-number v-model="form.unit_price" :min="0" :max="1000" :precision="2" placeholder="不填 = 按客户实付结" class="full" />
        <div class="hint">
          <template v-if="due !== null">应付客户 {{ form.quantity }} × {{ usd(form.unit_price) }} = <b>{{ usd(due) }}</b></template>
          <template v-else>不填单价时按客户在 Stripe 实际付的钱结，没法预先算</template>
        </div>
      </el-form-item>

      <!-- 付款：默认就是「已经付了」，和你的流程一致 -->
      <div class="pay">
        <div class="pay-head">
          <el-switch v-model="form.paid" />
          <b>我已经付了</b>
          <span class="muted small">{{ form.paid ? '派单时一起记下这笔钱' : '还没付，之后在批次里记' }}</span>
        </div>
        <template v-if="form.paid">
          <el-alert v-if="walletWarn" type="warning" :closable="false" show-icon :title="walletWarn" class="pay-warn" />
          <div class="two">
            <el-form-item label="付了多少（USD）">
              <el-input-number v-model="form.amount" :min="0.01" :precision="2" controls-position="right" class="full" />
            </el-form-item>
            <el-form-item label="交易哈希（选填）">
              <el-input v-model="form.tx_hash" class="mono-input" placeholder="0x…" spellcheck="false" />
            </el-form-item>
          </div>
          <div class="two">
            <el-form-item label="凭证（选填）">
              <!-- 和 SettleModal 同一种写法：before-upload 收下文件并返回 false，不走组件自己的上传 -->
              <el-upload
                :file-list="fileList"
                :before-upload="beforeUpload"
                :limit="1"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                @remove="(proof = null), (fileList = [])"
              >
                <el-button v-if="!fileList.length" :icon="Paperclip">截图 / PDF</el-button>
              </el-upload>
            </el-form-item>
            <el-form-item label="打款备注（选填）">
              <el-input v-model="form.pay_note" maxlength="255" placeholder="如：含上次欠的 3 美元" />
            </el-form-item>
          </div>
        </template>
      </div>

      <el-collapse v-model="more" class="more">
        <el-collapse-item title="更多选项" name="more">
          <div class="two">
            <el-form-item label="可更换次数">
              <el-input-number v-model="form.replace_limit" :min="0" :max="1000" placeholder="不填 = 和数量一样" class="full" />
            </el-form-item>
            <el-form-item label="备注（客户能看到）">
              <el-input v-model="form.note" maxlength="255" />
            </el-form-item>
          </div>
          <div class="muted small">
            客户可以多次领取，已付 + 手里待付不超过数量；超过领取时限没付的自动收回换新、不占名额。
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">{{ form.paid ? '派单并记下打款' : '派单' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.full { width: 100%; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; line-height: 1.5; }
.hint.warn { color: var(--el-color-warning); }
/* 付款区块：和上面的批次信息分开，一眼看出这是「钱」 */
.pay {
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px 2px;
  margin-bottom: 14px;
  background: var(--el-fill-color-lighter);
}
.pay-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.pay-warn { margin-bottom: 12px; }
.more { border-top: none; }
.more :deep(.el-collapse-item__header) { font-size: 13px; color: var(--el-text-color-secondary); }
@media (max-width: 760px) { .two { grid-template-columns: 1fr; } }
</style>
