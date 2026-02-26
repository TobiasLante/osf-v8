import DOMPurify from 'isomorphic-dompurify';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['h1','h2','h3','strong','em','code','pre','a','table','tr','td','th','li','ul','ol','br','p','span'],
  ALLOWED_ATTR: ['href','target','rel','class'],
};

export function safeMarkdown(md: string): string {
  return DOMPurify.sanitize(renderMarkdown(md), PURIFY_CONFIG);
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    )
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => c.trim().match(/^[-:]+$/))) return "";
      const tag = "td";
      return (
        "<tr>" +
        cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join("") +
        "</tr>"
      );
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, "<table>$&</table>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n/g, "<br>");
}

export function formatToolName(name: string): string {
  return (name || "")
    .replace(/^factory_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
