import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

/** Markdown → 安全 HTML（DOMPurify 白名单，与旧前端 markdown.js 同一安全基线）。 */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text || "", { async: false }) as string;
      return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
    } catch {
      return DOMPurify.sanitize(text || "");
    }
  }, [text]);
  return <div className={`markdown-body ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
