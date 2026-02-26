export interface WikiArticle {
  slug: string;
  title: string;
  description: string;
  category: WikiCategory;
}

export type WikiCategory =
  | "Einstieg"
  | "Architektur"
  | "Guides"
  | "Referenz"
  | "Betrieb";

export const wikiCategories: WikiCategory[] = [
  "Einstieg",
  "Architektur",
  "Guides",
  "Referenz",
  "Betrieb",
];

export const wikiArticles: WikiArticle[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description: "Registration, your first flow, your first agent",
    category: "Einstieg",
  },
  {
    slug: "architecture",
    title: "Architecture Overview",
    description: "Frontend, Gateway, MCP servers, Factory Simulation",
    category: "Architektur",
  },
  {
    slug: "visual-flows",
    title: "Visual Flows Guide",
    description: "Build multi-step AI workflows with the Node-RED editor",
    category: "Guides",
  },
  {
    slug: "code-agents",
    title: "Code Agents Guide",
    description: "Write TypeScript agents, deploy from GitHub",
    category: "Guides",
  },
  {
    slug: "node-reference",
    title: "Node-RED Custom Nodes",
    description: "All 16 custom OSF nodes in detail",
    category: "Referenz",
  },
  {
    slug: "api-reference",
    title: "API Reference",
    description: "Auth, Chat, Agents, Flows, MCP endpoints",
    category: "Referenz",
  },
  {
    slug: "mcp-tools",
    title: "MCP Tools Reference",
    description: "All 111 MCP tools across 4 domains",
    category: "Referenz",
  },
  {
    slug: "factory-simulation",
    title: "Factory Simulation",
    description: "Machines, data model, MCP domains",
    category: "Referenz",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting & FAQ",
    description: "Common errors, debugging tips, FAQ",
    category: "Betrieb",
  },
  {
    slug: "self-hosting",
    title: "Self-Hosting Guide",
    description: "Docker, Kubernetes, environment variables",
    category: "Betrieb",
  },
];

export function getArticleBySlug(slug: string): WikiArticle | undefined {
  return wikiArticles.find((a) => a.slug === slug);
}

export function getArticlesByCategory(category: WikiCategory): WikiArticle[] {
  return wikiArticles.filter((a) => a.category === category);
}

export function getAllSlugs(): string[] {
  return wikiArticles.map((a) => a.slug);
}
