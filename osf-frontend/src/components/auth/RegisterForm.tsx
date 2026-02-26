"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const { register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await register(email, password, name || undefined, marketingConsent);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    setResendMessage("");
    try {
      await apiFetch("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResendMessage("Verification email sent! Check your inbox.");
    } catch (err: any) {
      setResendMessage(err.message || "Failed to resend. Try again later.");
    } finally {
      setResendLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold">Check your email</h3>
        <p className="text-text-muted text-sm">
          We sent a verification link to <span className="text-text font-medium">{email}</span>.
          Click the link to activate your account.
        </p>
        <div className="pt-2">
          <button
            onClick={handleResend}
            disabled={resendLoading}
            className="text-sm text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
          >
            {resendLoading ? "Sending..." : "Didn't receive it? Resend"}
          </button>
          {resendMessage && (
            <p className="mt-2 text-sm text-text-muted">{resendMessage}</p>
          )}
        </div>
        <p className="text-sm text-text-dim pt-4">
          Already verified?{" "}
          <Link href="/login" className="text-accent hover:text-accent-hover transition-colors">
            Sign in
          </Link>
        </p>
        <p className="text-xs text-text-dim">
          Still having issues?{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              const u = "tobias.lante74";
              const d = "gmail.com";
              window.location.href = `mailto:${u}@${d}`;
            }}
            className="text-accent/70 hover:text-accent transition-colors"
          >
            Contact support
          </a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="block text-sm text-text-muted mb-1.5">
          Name (optional)
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 rounded-sm bg-bg-surface-2 border border-border text-text placeholder:text-text-dim focus:border-accent/40 focus:outline-none transition-colors"
          placeholder="Your name"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm text-text-muted mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-3 rounded-sm bg-bg-surface-2 border border-border text-text placeholder:text-text-dim focus:border-accent/40 focus:outline-none transition-colors"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm text-text-muted mb-1.5">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full px-4 py-3 rounded-sm bg-bg-surface-2 border border-border text-text placeholder:text-text-dim focus:border-accent/40 focus:outline-none transition-colors"
          placeholder="Min. 8 characters"
        />
      </div>

      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-border bg-bg-surface-2 text-accent focus:ring-accent/40 focus:ring-offset-0 cursor-pointer"
        />
        <span className="text-xs text-text-muted leading-relaxed group-hover:text-text transition-colors">
          I&apos;d like to receive occasional updates about new features and news from OpenShopFloor. Unsubscribe anytime.
        </span>
      </label>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-sm bg-accent text-bg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        {loading ? "Creating account..." : "Create Account"}
      </button>

      <p className="text-sm text-text-dim text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:text-accent-hover transition-colors">
          Sign in
        </Link>
      </p>

      <p className="text-xs text-text-dim text-center">
        Need help?{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            const u = "tobias.lante74";
            const d = "gmail.com";
            window.location.href = `mailto:${u}@${d}`;
          }}
          className="text-accent/70 hover:text-accent transition-colors"
        >
          Contact support
        </a>
      </p>
    </form>
  );
}
