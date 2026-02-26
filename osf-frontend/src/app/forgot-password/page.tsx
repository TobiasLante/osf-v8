"use client";

import { useState } from "react";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { apiFetch } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Reset your password</h1>
            <p className="text-text-muted">
              Enter your email and we&apos;ll send you a reset link
            </p>
          </div>
          <div className="bg-bg-surface border border-border rounded-md p-8">
            {sent ? (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold">Check your email</h3>
                <p className="text-text-muted text-sm">
                  If an account with <span className="text-text font-medium">{email}</span> exists,
                  you&apos;ll receive a password reset link shortly.
                </p>
                <p className="text-sm text-text-dim pt-4">
                  <Link href="/login" className="text-accent hover:text-accent-hover transition-colors">
                    Back to login
                  </Link>
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
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

                {error && (
                  <p className="text-sm text-red-400">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-sm bg-accent text-bg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send Reset Link"}
                </button>

                <p className="text-sm text-text-dim text-center">
                  Remember your password?{" "}
                  <Link href="/login" className="text-accent hover:text-accent-hover transition-colors">
                    Sign in
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
