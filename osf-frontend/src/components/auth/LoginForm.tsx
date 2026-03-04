"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setResendMessage("");
    setLoading(true);

    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403 && err.message.includes("verify")) {
        setNeedsVerification(true);
        setError("Please verify your email before signing in.");
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
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

  return (
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

      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label htmlFor="password" className="block text-sm text-text-muted">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-accent hover:text-accent-hover transition-colors">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="w-full px-4 py-3 rounded-sm bg-bg-surface-2 border border-border text-text placeholder:text-text-dim focus:border-accent/40 focus:outline-none transition-colors"
          placeholder="Min. 6 characters"
        />
      </div>

      {error && (
        <div>
          <p className="text-sm text-red-400">{error}</p>
          {needsVerification && (
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendLoading}
              className="mt-2 text-sm text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
            >
              {resendLoading ? "Sending..." : "Resend verification email"}
            </button>
          )}
          {resendMessage && (
            <p className="mt-1 text-sm text-text-muted">{resendMessage}</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-sm bg-accent text-bg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>

      <p className="text-sm text-text-dim text-center">
        No account yet?{" "}
        <Link href="/register" className="text-accent hover:text-accent-hover transition-colors">
          Create one
        </Link>
      </p>
    </form>
  );
}
