import { test, expect } from "@playwright/test";

/**
 * 冒烟流程：注册 → 登录态 → 上传 → 文件列表可见 → AI 对话（需要已配置 LLM 时手动跑）→ 登出。
 * 依赖后端 :8899 运行（playwright.config.ts 顶部注释）。
 */

const USERNAME = `e2e_${Date.now()}`;
const PASSWORD = "E2e-pass-12345";

test("注册 → 上传 → 列表 → 回收站 → 登出", async ({ page }) => {
  await page.goto("/");

  // 未登录 → 登录页
  await expect(page.getByText("欢迎回来")).toBeVisible();

  // 切到注册
  await page.getByText("创建新账户").click();
  await page.getByPlaceholder("用户名").fill(USERNAME);
  await page.getByPlaceholder("密码").fill(PASSWORD);
  await page.getByPlaceholder("密保问题（如：我的小学名称？）").fill("e2e?");
  await page.getByPlaceholder("密保答案").fill("e2e");
  await page.getByRole("button", { name: "注 册" }).click();

  // 注册成功进入文件库（空态）
  await expect(page.getByText("这个目录还是空的")).toBeVisible({ timeout: 10_000 });

  // 上传一个文本文件
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "e2e-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("e2e 测试文件内容"),
  });
  await expect(page.getByText("已上传 e2e-note.txt")).toBeVisible({ timeout: 10_000 });

  // 列表中出现该文件
  await expect(page.getByText("e2e-note.txt").first()).toBeVisible();

  // 删除 → 进回收站
  await page.getByText("e2e-note.txt").first().hover();
  await page.locator("tr", { hasText: "e2e-note.txt" }).getByTitle("删除").click();
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page.getByText("已移入回收站")).toBeVisible();

  // 回收站可见
  await page.getByText("回收站", { exact: true }).first().click();
  await expect(page.getByText("e2e-note.txt").first()).toBeVisible({ timeout: 10_000 });

  // 恢复
  await page.locator("tr,div", { hasText: "e2e-note.txt" }).getByText("恢复").first().click();

  // 登出
  await page.locator("header").getByText(USERNAME).click();
  await page.getByText("退出登录").click();
  await expect(page.getByText("欢迎回来")).toBeVisible({ timeout: 10_000 });
});

test("登录失败显示错误", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill("not-exist-user-xyz");
  await page.getByPlaceholder("密码").fill("wrong-pass");
  await page.getByRole("button", { name: "登 录" }).click();
  await expect(page.locator(".text-danger").first()).toBeVisible({ timeout: 8_000 });
});
