"use client";

import { useEffect, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";

interface BannerData {
  message: string;
  type: "maintenance" | "news";
  active: boolean;
}

export function AnnouncementBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/news/banner`)
      .then((r) => r.json())
      .then((data) => {
        if (data.banner?.active) setBanner(data.banner);
      })
      .catch(() => {});
  }, []);

  if (!banner) return null;

  const isMaintenance = banner.type === "maintenance";

  return (
    <div
      className={`w-full h-8 flex items-center overflow-hidden text-white text-sm font-medium ${
        isMaintenance ? "bg-red-600" : "bg-amber-600"
      }`}
    >
      <div className="animate-marquee whitespace-nowrap flex items-center gap-2">
        <span>{isMaintenance ? "\u{1F527}" : "\u{1F4E2}"}</span>
        <span>{banner.message}</span>
        <span className="mx-8" aria-hidden="true">
          &bull;
        </span>
        <span>{isMaintenance ? "\u{1F527}" : "\u{1F4E2}"}</span>
        <span>{banner.message}</span>
        <span className="mx-8" aria-hidden="true">
          &bull;
        </span>
        <span>{isMaintenance ? "\u{1F527}" : "\u{1F4E2}"}</span>
        <span>{banner.message}</span>
      </div>
    </div>
  );
}
