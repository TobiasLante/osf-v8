"use client";

import { useEffect, useState } from "react";
import { safeMarkdown } from "@/lib/markdown";

interface NewsItem {
  id: string;
  title: string;
  content: string;
  author_name: string;
  created_at: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/news`)
      .then((res) => res.json())
      .then((data) => setNews(data.news || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="pt-24 pb-16 px-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-text mb-2">News</h1>
      <p className="text-text-muted mb-8">Latest updates from OpenShopFloor</p>

      {loading && <div className="text-text-muted">Loading...</div>}
      {error && <div className="text-red-400">{error}</div>}

      <div className="space-y-8">
        {news.map((item) => (
          <article
            key={item.id}
            className="bg-surface border border-border rounded-lg p-6"
          >
            <h2 className="text-xl font-semibold text-text mb-2">
              {item.title}
            </h2>
            <div className="text-xs text-text-muted mb-4">
              {new Date(item.created_at).toLocaleDateString("de-DE", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}{" "}
              — {item.author_name}
            </div>
            <div
              className="prose prose-invert text-sm text-text-muted [&_h1]:text-text [&_h2]:text-text [&_h3]:text-text [&_strong]:text-text [&_a]:text-accent [&_code]:text-accent [&_pre]:bg-bg [&_pre]:p-3 [&_pre]:rounded [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1"
              dangerouslySetInnerHTML={{ __html: safeMarkdown(item.content) }}
            />
          </article>
        ))}

        {!loading && news.length === 0 && (
          <div className="text-center text-text-dim py-12">
            No news yet. Check back soon!
          </div>
        )}
      </div>
    </main>
  );
}
