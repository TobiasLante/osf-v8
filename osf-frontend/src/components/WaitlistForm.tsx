"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    // TODO: Replace with CF D1/Worker backend
    window.open(
      `mailto:tobias@zeroguess.ai?subject=OpenShopFloor Waitlist&body=Please add me to the waitlist: ${encodeURIComponent(email)}`,
      "_blank"
    );
    setSubmitted(true);
    setEmail("");
  }

  if (submitted) {
    return (
      <div className="text-center p-8 rounded-md border border-accent/20 bg-accent/5">
        <div className="text-2xl mb-2">&#10003;</div>
        <h3 className="font-semibold text-accent mb-1">Thanks for your interest!</h3>
        <p className="text-sm text-text-muted">
          We&apos;ll be in touch when OpenShopFloor launches.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-2">Get Early Access</h2>
      <p className="text-sm text-text-muted mb-6">
        Be first to build AI agents on a real factory simulation.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-3 max-w-md mx-auto">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="flex-1 px-4 py-3 rounded-sm bg-bg-surface border border-border text-text text-sm placeholder:text-text-dim focus:outline-none focus:border-accent/40 transition-colors"
        />
        <button
          type="submit"
          className="px-6 py-3 rounded-sm bg-accent-gradient text-bg font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Join Waitlist
        </button>
      </form>
    </div>
  );
}
