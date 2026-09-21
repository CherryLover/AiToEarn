import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vitest/config'

/**
 * 覆盖率只盯「这个 fork 自己写的模块」。
 *
 * 这个服务本来就带着上游那套 AI 能力（Eko 运行时、一堆剪辑和字幕 MCP 工具），
 * 它们不在这条改造链路上、也没人改，算进分母只会让覆盖率变成一个没人看得懂的数字。
 * 所以这里是白名单，只有这个 fork 自己建出来的那几个文件：
 * 项目工作区、技能初始化，以及整个 Bark 通知模块。
 * `agent-runtime.service.ts` 是上游的文件，这边只改了几处，不算进来。
 */
const OWNED = [
  'src/core/agent/services/project-workspace.service.ts',
  'src/core/agent/skill-init.service.ts',
  'src/core/notify/**/*.ts',
]

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/aitoearn-ai',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'aitoearn-ai',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reportsDirectory: '../../coverage/apps/aitoearn-ai',
      provider: 'v8' as const,
      reporter: ['text-summary', 'json-summary', 'html'],
      include: OWNED,
      exclude: [
        '**/*.{test,spec}.ts',
        // 纯声明没有可执行分支，进分母只会稀释信号
        '**/*.dto.ts',
        '**/*.module.ts',
        '**/*.constants.ts',
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
