import { test, expect } from "@playwright/test";

/**
 * 图标系统真实浏览器验证（不依赖后端）：
 * 1. sprite symbol 全量注入
 * 2. <use href="#sx-ico-*"> 正确解析到几何（非空渲染）
 * 3. 显式尺寸生效（不是 300×300 默认坑）
 * 4. .sx-ico 描边规格（currentColor / 1.5）
 */
test("图标精灵注入且 <use> 正确渲染几何与尺寸", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // 1. sprite symbol 数量（含 copy 等）
  const n = await page.locator('symbol[id^="sx-ico-"]').count();
  expect(n).toBeGreaterThanOrEqual(50);

  // 2~4. 注入若干图标，验证渲染
  const probe = await page.evaluate(() => {
    const NS = "http://www.w3.org/2000/svg";
    const names = ["trash", "folder", "sparkles", "file-pdf" /* 不存在 */, "file-text", "settings"];
    const out: Record<string, any> = {};
    for (const name of names) {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "sx-ico");
      svg.setAttribute("width", "24");
      svg.setAttribute("height", "24");
      const use = document.createElementNS(NS, "use");
      use.setAttribute("href", `#sx-ico-${name}`);
      svg.appendChild(use);
      document.body.appendChild(svg);
      const r = svg.getBoundingClientRect();
      let hasGeom = false;
      try {
        const b = (svg as SVGSVGElement).getBBox();
        hasGeom = b.width > 0 && b.height > 0;
      } catch {
        hasGeom = false;
      }
      const cs = window.getComputedStyle(svg);
      out[name] = {
        w: Math.round(r.width),
        h: Math.round(r.height),
        hasGeom,
        stroke: cs.strokeWidth,
        fill: cs.fill,
      };
      svg.remove();
    }
    return out;
  });

  // 存在的图标：尺寸 24×24、有几何、线性规格
  for (const name of ["trash", "folder", "sparkles", "file-text", "settings"]) {
    expect(probe[name].w, `${name} width`).toBe(24);
    expect(probe[name].h, `${name} height`).toBe(24);
    expect(probe[name].hasGeom, `${name} renders geometry`).toBe(true);
    expect(probe[name].stroke, `${name} stroke-width`).toBe("1.5px");
    expect(probe[name].fill, `${name} fill none`).toBe("none");
  }
  // 不存在的图标：无几何（<use> 解析为空），但 svg 仍 24×24
  expect(probe["file-pdf"].hasGeom).toBe(false);
});
