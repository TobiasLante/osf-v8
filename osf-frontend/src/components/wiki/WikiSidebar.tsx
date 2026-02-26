"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  wikiCategories,
  getArticlesByCategory,
} from "@/lib/wiki-data";

export function WikiSidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24 space-y-6">
        <Link
          href="/docs"
          className="text-text-muted hover:text-accent text-sm inline-flex items-center gap-1 transition-colors"
        >
          &larr; Docs Hub
        </Link>

        {wikiCategories.map((cat) => {
          const articles = getArticlesByCategory(cat);
          return (
            <div key={cat}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-2">
                {cat}
              </h4>
              <ul className="space-y-1">
                {articles.map((article) => {
                  const href = `/docs/wiki/${article.slug}`;
                  const isActive = pathname === href;
                  return (
                    <li key={article.slug}>
                      <Link
                        href={href}
                        className={`block text-sm px-3 py-1.5 rounded transition-colors ${
                          isActive
                            ? "bg-accent/10 text-accent font-medium"
                            : "text-text-muted hover:text-text hover:bg-bg-surface-2"
                        }`}
                      >
                        {article.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
