"use client";

import Link from "next/link";
import { getArticleBySlug, wikiArticles } from "@/lib/wiki-data";
import { wikiContent } from "@/lib/wiki-content";

export function WikiPageClient({ slug }: { slug: string }) {
  const article = getArticleBySlug(slug);
  const Content = wikiContent[slug];

  if (!article || !Content) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold mb-4">Article not found</h1>
        <Link href="/docs" className="text-accent hover:underline">
          Back to Docs
        </Link>
      </div>
    );
  }

  // Find prev/next articles
  const idx = wikiArticles.findIndex((a) => a.slug === slug);
  const prev = idx > 0 ? wikiArticles[idx - 1] : null;
  const next = idx < wikiArticles.length - 1 ? wikiArticles[idx + 1] : null;

  return (
    <div>
      {/* Mobile back link */}
      <Link
        href="/docs"
        className="text-text-muted hover:text-accent text-sm mb-6 inline-block lg:hidden"
      >
        &larr; Docs Hub
      </Link>

      <h1 className="text-3xl sm:text-4xl font-bold mb-3">{article.title}</h1>
      <p className="text-text-muted mb-8 text-lg">{article.description}</p>

      <div className="space-y-8">
        <Content />
      </div>

      {/* Prev / Next navigation */}
      <div className="mt-12 pt-6 border-t border-border flex justify-between">
        {prev ? (
          <Link
            href={`/docs/wiki/${prev.slug}`}
            className="text-sm text-text-muted hover:text-accent transition-colors"
          >
            &larr; {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/docs/wiki/${next.slug}`}
            className="text-sm text-text-muted hover:text-accent transition-colors"
          >
            {next.title} &rarr;
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
