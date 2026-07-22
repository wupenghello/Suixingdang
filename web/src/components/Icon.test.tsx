import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("渲染 <use> 引用对应 symbol", () => {
    const { container } = render(<Icon name="trash" />);
    const useEl = container.querySelector("use");
    expect(useEl).toBeTruthy();
    expect(useEl!.getAttribute("href")).toBe("#sx-ico-trash");
  });

  it("显式 width/height（规避 SVG 无尺寸渲染 300×300 坑）", () => {
    const { container } = render(<Icon name="folder" size={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
  });

  it("默认 16px + 线性规格（fill none / stroke currentColor / 1.5）", () => {
    const { container } = render(<Icon name="x" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
  });

  it("无 label 时为装饰性：aria-hidden + 无 role", () => {
    const { container } = render(<Icon name="chevron-down" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("有 label 时为语义图标：role=img + aria-label，不 aria-hidden", () => {
    const { container } = render(<Icon name="trash" label="删除" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("删除");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("透传 className 与 style", () => {
    const { container } = render(
      <Icon name="trash" className="hover:!text-danger" style={{ color: "var(--color-type-pdf)" }} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("hover:!text-danger");
    expect(svg.style.color).toBe("var(--color-type-pdf)");
  });
});
