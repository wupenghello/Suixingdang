import { defineConfig } from "@playwright/test";

/**
 * E2E：需要本地起后端（start.sh 起 8899 用户端）+ vite dev/preview。
 * 本地运行：
 *   cd server && ./start.sh           # 后端 :8899（首次会复制 .env.test）
 *   cd web && npm run dev             # 前端 :5173（代理 /api → 8899）
 *   cd web && npx playwright install chromium
 *   cd web && npm run e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5173/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
