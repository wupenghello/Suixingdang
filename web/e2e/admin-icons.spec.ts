import { test, expect } from "@playwright/test";

/**
 * Admin 后台图标统一性验证（需后端 8899，admin 凭据见 .env.test）。
 * 登录后断言：导航图标均为 svg.sx-ico，无 Material 实心 fill=currentColor 残留。
 */
test("admin 导航图标为统一线性 svg.sx-ico，无实心残留", async ({ page }) => {
  await page.goto("http://127.0.0.1:8899/admin/");
  await page.fill("#login-user", "admin");
  await page.fill("#login-pass", "test123456");
  await page.press("#login-pass", "Enter");

  await page.waitForSelector(".admin-nav-item", { timeout: 10_000 });

  const navIcons = page.locator(".admin-nav-item svg.sx-ico");
  await expect(navIcons.first()).toBeVisible();
  const count = await navIcons.count();
  expect(count, "admin 侧栏至少 4 个导航图标").toBeGreaterThanOrEqual(4);

  // 无 Material 实心图标残留（fill="currentColor" 属性）
  const solid = await page.locator('svg[fill="currentColor"]').count();
  expect(solid, "不应残留实心 fill=currentColor 图标").toBe(0);

  // 抽查一个导航图标引用了精灵 symbol
  const firstUse = await page.locator(".admin-nav-item svg use").first().getAttribute("href");
  expect(firstUse).toMatch(/^#sx-ico-/);

  await page.screenshot({ path: "e2e/__screenshots__/admin.png", fullPage: true });
});
