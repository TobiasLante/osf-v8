import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { WelcomeModal } from "@/components/WelcomeModal";
import { CookieBanner } from "@/components/CookieBanner";
import { AuthProvider } from "@/lib/auth-context";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenShopFloor — Free Manufacturing AI Playground",
  description:
    "Build manufacturing AI agents in minutes. 111 MCP tools, live factory data, visual flows, and gamified challenges — all free.",
  keywords: [
    "AI agents",
    "manufacturing",
    "MCP",
    "Model Context Protocol",
    "factory simulation",
    "OEE",
    "open source",
    "sandbox",
    "Industry 4.0",
    "Node-RED",
    "agentic AI",
    "manufacturing AI",
    "capacity planning",
    "quality management",
  ],
  metadataBase: new URL("https://openshopfloor.zeroguess.ai"),
  alternates: {
    canonical: "/",
    languages: {
      "en": "/",
      "x-default": "/",
    },
  },
  openGraph: {
    title: "OpenShopFloor — Free Manufacturing AI Playground",
    description:
      "Build manufacturing AI agents in minutes. 111 MCP tools, live factory data, visual flows, and challenges — all free.",
    url: "https://openshopfloor.zeroguess.ai",
    siteName: "OpenShopFloor",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "OpenShopFloor — AI agent flow editor with 111 MCP tools for manufacturing",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@ZeroGuessAI",
    creator: "@TobiasLante",
    title: "OpenShopFloor — Free Manufacturing AI Playground",
    description:
      "111 MCP tools for manufacturing AI. Build, test, and deploy AI agents with real factory data. Free.",
    images: ["/images/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
  other: {
    "msapplication-TileColor": "#0a0a0f",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <Script
          src="https://analytics.zeroguess.ai/script.js"
          data-website-id="4827bc0b-2b61-4d7a-bfca-feca339ca05d"
          strategy="afterInteractive"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebSite",
                  "name": "OpenShopFloor",
                  "url": "https://openshopfloor.zeroguess.ai",
                  "description":
                    "Free Manufacturing AI Playground. 111 MCP tools, visual flow editor, AI agent builder, gamified challenges.",
                },
                {
                  "@type": "SoftwareApplication",
                  "name": "OpenShopFloor",
                  "applicationCategory": "DeveloperApplication",
                  "operatingSystem": "Linux, macOS, Windows",
                  "url": "https://openshopfloor.zeroguess.ai",
                  "description":
                    "Free Manufacturing AI Playground with 111 MCP tools. Build, test, and deploy manufacturing AI agents with real ERP, OEE, QMS, and WMS data.",
                  "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD",
                    "description": "100% free — no credit card required",
                  },
                  "featureList": [
                    "111 MCP tools for manufacturing",
                    "Visual flow editor (Node-RED)",
                    "Multi-step agent chains",
                    "AI chat with factory data",
                    "TypeScript agent SDK",
                    "BYOK — Bring your own LLM key",
                    "Factory simulator with 30 machines",
                  ],
                  "screenshot": "https://openshopfloor.zeroguess.ai/images/og-image.png",
                  "author": {
                    "@type": "Organization",
                    "name": "OpenShopFloor",
                    "url": "https://github.com/TobiasLante/openshopfloor",
                  },
                  "license": "https://www.gnu.org/licenses/agpl-3.0.html",
                  "codeRepository": "https://github.com/TobiasLante/openshopfloor",
                },
                {
                  "@type": "Organization",
                  "name": "OpenShopFloor",
                  "url": "https://openshopfloor.zeroguess.ai",
                  "logo": "https://openshopfloor.zeroguess.ai/images/og-image.png",
                  "sameAs": [
                    "https://github.com/TobiasLante/openshopfloor",
                    "https://www.npmjs.com/package/node-red-contrib-mcp",
                    "https://flows.nodered.org/node/node-red-contrib-mcp",
                  ],
                },
              ],
            }),
          }}
        />
      </head>
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <AuthProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <WelcomeModal />
          <CookieBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
