import React from "react";

/**
 * 统一图标组件 · 引用全局 <symbol> 精灵（见 web/index.html 内联的 icons.svg）。
 * 视觉规格：viewBox 24 / fill none / stroke currentColor / stroke-width 1.5 / round。
 * 显式 width/height 规避 SVG 无尺寸时渲染为 300×300 的坑。
 *
 * a11y：传 label 则 role="img"+aria-label（图标按钮/独立语义图标）；
 *       不传则 aria-hidden（装饰性，需搭配相邻可见文本）。
 *
 * name 取自精灵 symbol id 去掉 `sx-ico-` 前缀，如 "trash" -> #sx-ico-trash。
 */
export function Icon({
  name,
  size = 16,
  className = "",
  label,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`sx-ico ${className}`}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <use href={`#sx-ico-${name}`} />
    </svg>
  );
}

export type IconName = string;
