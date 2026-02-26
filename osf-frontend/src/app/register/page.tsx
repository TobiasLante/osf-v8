"use client";

import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Create your account</h1>
            <p className="text-text-muted">
              Free account — each user gets a dedicated AI workspace with live factory access
            </p>
          </div>
          <div className="bg-bg-surface border border-border rounded-md p-8">
            <RegisterForm />
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
