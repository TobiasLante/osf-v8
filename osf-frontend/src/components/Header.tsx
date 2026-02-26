"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/explore", label: "Explore" },
  { href: "/agents", label: "Agents" },
  { href: "/challenges", label: "Challenges" },
  { href: "/use-cases", label: "Use Cases" },
  { href: "/docs", label: "Docs" },
  { href: "/community", label: "Community" },
  { href: "/news", label: "News" },
];

const userLinks = [
  { href: "/chains", label: "Chains" },
  { href: "/flows", label: "Flows" },
  { href: "/chat", label: "Chat" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings", label: "Settings" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout, loading } = useAuth();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Hide header on full-screen pages like the flow editor
  if (pathname === "/flows/editor") return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg/80 backdrop-blur-xl">
      <AnnouncementBanner />
      <nav className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-sm bg-accent-gradient flex items-center justify-center text-bg font-bold text-sm">
            OS
          </div>
          <span className="text-lg font-semibold text-text group-hover:text-accent transition-colors">
            OpenShopFloor
          </span>
          <span className="text-[10px] font-mono text-text-dim bg-bg-surface border border-border rounded px-1.5 py-0.5">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </span>
        </Link>

        {/* Right side: CTA + Burger */}
        <div className="flex items-center gap-3">
          {user ? (
            <Link
              href="/chat"
              className="text-sm px-4 py-2 rounded-sm bg-accent text-bg font-medium hover:bg-accent-hover transition-colors"
            >
              Chat
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="text-sm text-text-muted hover:text-accent transition-colors"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="text-sm px-4 py-2 rounded-sm bg-accent text-bg font-medium hover:bg-accent-hover transition-colors"
              >
                Sign Up
              </Link>
            </div>
          )}

          {/* Burger button */}
          <button
            className="text-text-muted hover:text-text p-2"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {menuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* Dropdown menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="border-t border-border bg-bg/95 backdrop-blur-xl"
        >
          <div className="mx-auto max-w-7xl px-6 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-1">
            {/* Platform section */}
            <div>
              <p className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-2">
                Platform
              </p>
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block py-1.5 text-sm transition-colors ${
                    pathname === link.href
                      ? "text-accent"
                      : "text-text-muted hover:text-accent"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* User section (logged in) */}
            {!loading && user && (
              <div>
                <p className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-2 mt-4 sm:mt-0">
                  Workspace
                </p>
                {userLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block py-1.5 text-sm transition-colors ${
                      pathname === link.href
                        ? "text-accent"
                        : "text-text-muted hover:text-accent"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                {user.role === "admin" && (
                  <Link
                    href="/admin"
                    className={`block py-1.5 text-sm transition-colors ${
                      pathname === "/admin"
                        ? "text-accent"
                        : "text-text-muted hover:text-accent"
                    }`}
                  >
                    Admin
                  </Link>
                )}
                <button
                  onClick={() => {
                    logout();
                    setMenuOpen(false);
                  }}
                  className="block py-1.5 text-sm text-text-dim hover:text-text transition-colors"
                >
                  Logout
                </button>
              </div>
            )}

            {/* Auth section (logged out) */}
            {!loading && !user && (
              <div className="sm:hidden">
                <p className="text-[10px] font-mono text-text-dim uppercase tracking-wider mb-2 mt-4">
                  Account
                </p>
                <Link
                  href="/login"
                  className="block py-1.5 text-sm text-text-muted hover:text-accent transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="block py-1.5 text-sm text-accent"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
