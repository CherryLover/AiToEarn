import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * 网页端的单元测试只盯「这个 fork 自己写的代码」。
 *
 * 仓库里还躺着上游那套多平台发布器的界面（七百多个文件、十几个平台的参数面板），
 * 它们不在这条改造链路上、也没人改，把它们算进分母只会让覆盖率变成一个
 * 没人看得懂的数字。所以 `coverage.include` 是白名单：
 * 改造涉及的 api 层、projects 页面、devices 页面和公共工具。
 */
const OWNED = [
  'src/api/angles/**/*.ts',
  'src/api/creator-notes/**/*.ts',
  'src/api/devices/**/*.ts',
  'src/api/projects/**/*.ts',
  'src/api/publishing/**/*.ts',
  'src/app/**/projects/**/*.{ts,tsx}',
  'src/app/**/devices/**/*.{ts,tsx}',
]

export default defineConfig({
  plugins: [react()],
  // `@/*` 走 tsconfig 的 paths，Vite 8 原生支持，不用再挂插件
  resolve: { tsconfigPaths: true },
  test: {
    name: 'aitoearn-web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: OWNED,
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        // 纯类型/常量声明没有可执行分支，进分母只会稀释信号
        '**/*.types.ts',
        '**/*.constants.ts',
        '**/page.tsx',
        '**/layout.tsx',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
})
