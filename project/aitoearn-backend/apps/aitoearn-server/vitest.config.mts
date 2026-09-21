import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vitest/config'

/**
 * 覆盖率只盯「这个 fork 自己写的模块」。
 *
 * 仓库里还带着上游那套多平台发布器（十几个平台的 provider、内容库、发布记录），
 * 它们不在这条改造链路上、也没人改，算进分母只会让覆盖率变成一个没人看得懂的数字。
 * 所以这里是白名单：项目、物料、方向、发布、设备、工单、采集、设置。
 */
const OWNED = [
  'src/core/angles/**/*.ts',
  'src/core/creator-notes/**/*.ts',
  'src/core/devices/**/*.ts',
  'src/core/execution-tasks/**/*.ts',
  'src/core/projects/**/*.ts',
  'src/core/publishing/**/*.ts',
  'src/core/settings/**/*.ts',
]

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/aitoearn-server',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'aitoearn-server',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/aitoearn-server',
      provider: 'v8' as const,
      reporter: ['text-summary', 'json-summary', 'html'],
      include: OWNED,
      exclude: [
        '**/*.{test,spec}.ts',
        // 纯声明没有可执行分支，进分母只会稀释信号
        '**/*.dto.ts',
        '**/*.module.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
}))
