// 代付链接网站（客户门户 + 网页后台）的前端构建：Vue 3 + Element Plus
//
// 和桌面端完全分开：这里产出的是给 server/paylinks 下 PHP 页面加载的静态 js / css，
// 后端接口不变（api.php）。构建到 server/paylinks/assets/app/，仓库里带着产物，
// 部署时整个目录传上去即可，服务器上不需要 Node。
import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  root: resolve(__dirname, 'site'),
  plugins: [
    vue(),
    // Element Plus 按需引入：客户用手机打开，整包 900 KB 太大
    Components({ resolvers: [ElementPlusResolver({ importStyle: 'css' })], dts: false })
  ],
  resolve: {
    alias: { '@site': resolve(__dirname, 'site/src') }
  },
  build: {
    outDir: resolve(__dirname, 'server/paylinks/assets/app'),
    emptyOutDir: true,
    // PHP 页面用固定文件名引用，不要带 hash
    rollupOptions: {
      input: {
        portal: resolve(__dirname, 'site/src/portal/main.ts'),
        admin: resolve(__dirname, 'site/src/admin/main.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: '[name][extname]',
        // 公共依赖固定成 vendor，PHP 页面好引用；否则会按首个用到的组件命名
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor'
          if (id.includes('/site/src/shared/')) return 'vendor'
          return null
        }
      }
    },
    // 客户用手机访问，产物别太大；Element Plus 按需引入后约 400 KB
    chunkSizeWarningLimit: 900
  }
})
