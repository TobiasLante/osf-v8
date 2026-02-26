"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { apiFetch } from "@/lib/api";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-bg-surface border border-border rounded-md p-8 text-center">
        <h2 className="text-xl font-semibold mb-4">Invalid reset link</h2>
        <p className="text-text-muted text-sm mb-6">No reset token found. Please request a new password reset.</p>
        <Link href="/forgot-password" className="text-accent hover:text-accent-hover transition-colors text-sm">
          Request new reset link
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Set new password</h1>
        <p className="text-text-muted">
          Choose a strong password for your account
        </p>
      </div>
      <div className="bg-bg-surface border border-border rounded-md p-8">
        {success ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold">Password reset!</h3>
            <p className="text-text-muted text-sm">Redirecting to login...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="block text-sm text-text-muted mb-1.5">
                New Password
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

            <div>
              <label htmlFor="confirmPassword" className="block text-sm text-text-muted mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 rounded-sm bg-bg-surface-2 border border-border text-text placeholder:text-text-dim focus:border-accent/40 focus:outline-none transition-colors"
                placeholder="Repeat password"
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
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-md">
          <Suspense fallback={
            <div className="bg-bg-surface border border-border rounded-md p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <h2 className="text-xl font-semibold mb-2">Loading...</h2>
            </div>
          }>
            <ResetPasswordContent />
          </Suspense>
        </div>
      </section>
    </>
  );
}
