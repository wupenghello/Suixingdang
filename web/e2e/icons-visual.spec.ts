import { test, expect } from "@playwright/test";

/**
 * 图标统一性视觉验证（需后端 8899 + vite 5173）。
 * 登录后断言侧栏导航全部为线性 svg.sx-ico，并逐视图截图存档。
 */
test("登录后侧栏导航为统一线性图标，无 emoji", async ({ page }) => {
  await page.goto("/");
  await page.fill('input[placeholder="用户名"]', "icon_test");
  await page.fill('input[placeholder="密码"]', "test1234");
  await page.press('input[placeholder="密码"]', "Enter");

  // 等侧栏导航就绪
  await page.waitForSelector("aside nav button", { timeout: 10_000 });

  // 6 个导航图标都是 svg.sx-ico
  const navIcons = page.locator("aside nav button svg.sx-ico");
  await expect(navIcons).toHaveCount(6);

  // 侧栏按钮内不应残留 emoji 图标（按钮文本应为纯中文 label）
  const navTexts = await page.locator("aside nav button").allInnerTexts();
  for (const t of navTexts) {
    expect(t, `nav 文本不应含 emoji: ${t}`).toMatch(/^[\sA-Za-z一-鿿]+$/);
  }

  // 逐视图截图
  const views: [string, string][] = [
    ["#/files", "files"],
    ["#/chat", "chat"],
    ["#/notes", "notes"],
    ["#/transfer", "transfer"],
    ["#/trash", "trash"],
    ["#/settings", "settings"],
  ];
  for (const [hash, name] of views) {
    await page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `e2e/__screenshots__/view-${name}.png`,
      fullPage: true,
    });
  }
});
