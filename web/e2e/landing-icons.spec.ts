import { test, expect } from "@playwright/test";

/** Landing 落地页图标验证：sprite 注入 + 已有 <use> 引用渲染出几何（扩容后未破坏）。 */
test("landing 图标精灵渲染正常", async ({ page }) => {
  await page.goto("http://127.0.0.1:8899/welcome");
  await page.waitForLoadState("domcontentloaded");

  const n = await page.locator('symbol[id^="sx-ico-"]').count();
  expect(n).toBe(60);

  // 页面内已有的 <use> 引用应渲染出几何（非空）
  const rendered = await page.evaluate(() => {
    const uses = Array.from(document.querySelectorAll<SVGUseElement>("svg use[href^='#sx-ico-']"));
    let ok = 0;
    for (const u of uses) {
      const svg = u.ownerSVGElement;
      if (!svg) continue;
      try {
        const b = svg.getBBox();
        if (b.width > 0 && b.height > 0) ok++;
      } catch {
        /* ignore */
      }
    }
    return { total: uses.length, ok };
  });
  expect(rendered.total, "landing 有 <use> 图标引用").toBeGreaterThan(0);
  expect(rendered.ok, "所有 <use> 渲染出几何").toBe(rendered.total);

  await page.screenshot({ path: "e2e/__screenshots__/landing.png", fullPage: true });
});
