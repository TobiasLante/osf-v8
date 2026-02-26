"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setTokensAndUser } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setError("No verification token provided.");
      return;
    }

    apiFetch<{ token: string; refreshToken: string; user: any }>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((data) => {
        setTokensAndUser(data.token, data.refreshToken, data.user);
        setStatus("success");
        setTimeout(() => router.push("/dashboard"), 2000);
      })
      .catch((err: any) => {
        setStatus("error");
        setError(err.message || "Verification failed");
      });
  }, [searchParams, router, setTokensAndUser]);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResendLoading(true);
    setResendMessage("");
    try {
      await apiFetch("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: resendEmail }),
      });
      setResendMessage("Verification email sent! Check your inbox.");
    } catch (err: any) {
      setResendMessage(err.message || "Failed to resend.");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="bg-bg-surface border border-border rounded-md p-8 text-center">
      {status === "loading" && (
        <>
          <div className="w-12 h-12 mx-auto mb-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-semibold mb-2">Verifying your email...</h2>
          <p className="text-text-muted text-sm">Please wait a moment.</p>
        </>
      )}

      {status === "success" && (
        <>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Email verified!</h2>
          <p className="text-text-muted text-sm">Redirecting to your dashboard...</p>
        </>
      )}

      {status === "error" && (
        <>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Verification failed</h2>
          <p className="text-text-muted text-sm mb-6">{error}</p>

          <div className="space-y-3">
            <input
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="Enter your email to resend"
              className="w-full px-4 py-3 rounded-sm bg-bg-surface-2 border border-border text-text placeholder:text-text-dim focus:border-accent/40 focus:outline-none transition-colors text-sm"
            />
            <button
              onClick={handleResend}
              disabled={resendLoading || !resendEmail}
              className="w-full py-2.5 rounded-sm bg-accent text-bg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 text-sm"
            >
              {resendLoading ? "Sending..." : "Resend verification email"}
            </button>
            {resendMessage && (
              <p className="text-sm text-text-muted">{resendMessage}</p>
            )}
          </div>

          <p className="text-sm text-text-dim mt-6">
            <Link href="/login" className="text-accent hover:text-accent-hover transition-colors">
              Back to login
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
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
            <VerifyEmailContent />
          </Suspense>
        </div>
      </section>
    </>
  );
}
