import { test, expect } from "@playwright/test";

/** 客观视觉验证：导航图标的 computed style 符合设计系统（currentColor + token + 1.5px）。 */
test("导航图标 computed style 符合设计系统", async ({ page }) => {
  await page.goto("/");
  await page.fill('input[placeholder="用户名"]', "icon_test");
  await page.fill('input[placeholder="密码"]', "test1234");
  await page.press('input[placeholder="密码"]', "Enter");
  await page.waitForSelector("aside nav button svg.sx-ico", { timeout: 10_000 });

  const data = await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll<HTMLSVGSVGElement>("aside nav button svg.sx-ico"));
    return svgs.map((s) => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      // 找到所属 button 的 active 状态
      const btn = s.closest("button");
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        color: cs.color,
        stroke: cs.strokeWidth,
        fill: cs.fill,
        active: btn?.className.includes("text-primary") || !!btn?.querySelector("span.bg-primary") || (cs.color === "rgb(51, 112, 255)"),
      };
    });
  });

  expect(data.length).toBe(6);
  for (const d of data) {
    expect(d.w, "icon width 16").toBe(16);
    expect(d.h, "icon height 16").toBe(16);
    expect(d.stroke, "stroke 1.5").toBe("1.5px");
    expect(d.fill, "fill none").toBe("none");
  }
  // files 为当前视图 -> 其图标应为品牌蓝
  expect(data[0].color, "active nav icon 颜色=品牌蓝").toBe("rgb(51, 112, 255)");

  // 设置页：点"存储统计"，StatTile 三个图标应为线性 svg（验证非 emoji）
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  await page.click('aside nav button:has-text("存储统计")');
  await page.waitForTimeout(400);
  const statIcons = await page.locator("section svg.sx-ico").count();
  expect(statIcons, "存储统计 StatTile 图标").toBeGreaterThanOrEqual(3);
});
