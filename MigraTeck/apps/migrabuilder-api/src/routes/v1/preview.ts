import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Server-side doc → HTML renderer (no auth required — can be called internally)
const PreviewSchema = z.object({
  doc: z.unknown(),
  theme: z.record(z.unknown()).optional(),
  title: z.string().optional(),
});

type DocNode = {
  id: string;
  type: string;
  settings?: Record<string, unknown>;
  children?: DocNode[];
};

function renderNode(node: DocNode, depth = 0): string {
  const s = node.settings ?? {};

  switch (node.type) {
    case "section": {
      const bg = s.background_color ? `style="background:${s.background_color}"` : "";
      const children = (node.children ?? []).map((c) => renderNode(c, depth + 1)).join("");
      return `<section class="mb-section" ${bg}><div class="mb-section-inner">${children}</div></section>`;
    }
    case "container": {
      const children = (node.children ?? []).map((c) => renderNode(c, depth + 1)).join("");
      return `<div class="mb-container">${children}</div>`;
    }
    case "heading": {
      const tag = String(s.tag ?? "h2");
      const text = String(s.text ?? "");
      const align = s.align ? `style="text-align:${s.align}"` : "";
      return `<${tag} class="mb-heading" ${align}>${escHtml(text)}</${tag}>`;
    }
    case "text_editor": {
      const content = String(s.content ?? "");
      return `<div class="mb-text">${content}</div>`;
    }
    case "image": {
      const src = String(s.url ?? s.src ?? "");
      const alt = escHtml(String(s.alt ?? ""));
      if (!src) return "";
      return `<figure class="mb-image"><img src="${escAttr(src)}" alt="${alt}" /></figure>`;
    }
    case "button": {
      const text = escHtml(String(s.text ?? "Button"));
      const url = escAttr(String(s.url ?? "#"));
      const target = s.new_tab ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<div class="mb-button-wrap"><a class="mb-button" href="${url}"${target}>${text}</a></div>`;
    }
    case "divider":
      return `<hr class="mb-divider" />`;
    case "spacer": {
      const px = Number(s.height ?? 40);
      return `<div class="mb-spacer" style="height:${px}px"></div>`;
    }
    case "heading_counter": {
      const end = Number(s.end_number ?? 0);
      return `<div class="mb-counter">${end}</div>`;
    }
    case "progress": {
      const pct = Number(s.percent ?? 0);
      const label = escHtml(String(s.label ?? ""));
      return `<div class="mb-progress"><div class="mb-progress-label">${label}</div><div class="mb-progress-bar" style="width:${pct}%"></div></div>`;
    }
    case "testimonial": {
      const content = escHtml(String(s.content ?? ""));
      const author = escHtml(String(s.author_name ?? ""));
      return `<blockquote class="mb-testimonial"><p>${content}</p>${author ? `<cite>${author}</cite>` : ""}</blockquote>`;
    }
    case "site_logo": {
      const src = String(s.custom_logo_url ?? "");
      if (!src) return "";
      return `<div class="mb-site-logo"><img src="${escAttr(src)}" alt="Logo" /></div>`;
    }
    default: {
      const children = (node.children ?? []).map((c) => renderNode(c, depth + 1)).join("");
      return children ? `<div class="mb-${node.type}">${children}</div>` : "";
    }
  }
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(str: string): string {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function docToHtml(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const d = doc as { nodes?: DocNode[]; children?: DocNode[] };
  const nodes = d.nodes ?? d.children ?? [];
  return nodes.map((n) => renderNode(n)).join("\n");
}

export async function registerPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.post("/preview", async (request, reply) => {
    const parsed = PreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const { doc, title, theme } = parsed.data;
    const bodyHtml = docToHtml(doc);
    const pageTitle = escHtml(String(title ?? "Preview"));

    // Build CSS vars from theme tokens
    const themeVars = theme ? Object.entries(theme)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `  --mb-${k}: ${v};`)
      .join("\n") : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${pageTitle}</title>
<style>
:root {
${themeVars}
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; color: var(--mb-text, #111); background: var(--mb-bg, #fff); }
.mb-section { width: 100%; padding: 60px 16px; }
.mb-section-inner { max-width: 1200px; margin: 0 auto; }
.mb-container { display: flex; flex-wrap: wrap; gap: 24px; }
.mb-heading { margin: 0 0 16px; }
.mb-text { line-height: 1.6; }
.mb-image img, .mb-site-logo img { max-width: 100%; height: auto; display: block; }
.mb-button-wrap { margin: 16px 0; }
.mb-button { display: inline-block; padding: 12px 28px; background: var(--mb-accent, #5b6cf9); color: #fff; border-radius: calc(var(--mb-radius, 6) * 1px); text-decoration: none; font-weight: 600; }
.mb-divider { border: none; border-top: 1px solid var(--mb-border, #e2e8f0); margin: 24px 0; }
.mb-progress { margin: 12px 0; }
.mb-progress-label { margin-bottom: 4px; font-size: 0.875rem; }
.mb-progress-bar { height: 8px; background: var(--mb-accent, #5b6cf9); border-radius: 4px; }
.mb-counter { font-size: 2.5rem; font-weight: 700; color: var(--mb-accent, #5b6cf9); }
.mb-testimonial { border-left: 4px solid var(--mb-accent, #5b6cf9); margin: 0; padding: 16px 24px; }
.mb-testimonial cite { display: block; margin-top: 8px; font-style: normal; font-weight: 600; font-size: 0.875rem; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });
}
