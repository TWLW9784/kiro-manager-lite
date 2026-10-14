// 管理后台入口：Vue 3 + Element Plus（组件按需引入，见 vite.site.config.ts）
import { createApp } from 'vue'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-loading.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import '@site/shared/layout.css'
import App from './App.vue'

createApp(App).mount('#app')
