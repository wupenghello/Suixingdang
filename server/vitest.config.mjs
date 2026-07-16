import { defineConfig } from 'vitest/config';

// 随行档前端单测配置
// - environment: jsdom（innerHTML 序列化贴近浏览器：转义 < > &，escapeHtml 等 XSS 安全测试需要；
//   曾用 happy-dom，但其 innerHTML 不转义 <>，无法验证 escapeHtml 的转义契约，故换 jsdom）
// - 生产零构建不变：vitest 仅在开发/CI 跑，不产出生产包、不引入 bundler
// - coverage 只统计被抽离的 utils/（app.js 整体覆盖率暂不计，随 S2/S3 抽离推进逐步纳入）
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/web/setup.js'],
    include: ['tests/web/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['app/web/assets/utils/**/*.js'],
      // 覆盖率门槛（Q4：从低起步，随抽离推进渐升；未达则 CI 失败）
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 85,
        lines: 90,
      },
    },
  },
});
