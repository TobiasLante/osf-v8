"use client";

import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Welcome back</h1>
            <p className="text-text-muted">
              Sign in to access your factory AI workspace
            </p>
          </div>
          <div className="bg-bg-surface border border-border rounded-md p-8">
            <LoginForm />
          </div>
          <div className="mt-4 rounded-md border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-text-muted">
            <p className="font-medium text-text mb-1">Local LLM Availability</p>
            <p>
              Our free local LLM is available <strong className="text-text">Mon&ndash;Fri, 8:00&ndash;20:00 CET</strong> (Berlin time).
              Outside these hours, connect your own API key (OpenAI, Anthropic/Claude, or custom) in Settings.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
