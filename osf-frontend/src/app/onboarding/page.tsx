"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { LS_ONBOARDING_DONE } from "@/lib/constants";

const FACTORY_URL =
  process.env.NEXT_PUBLIC_FACTORY_URL || "https://osf-factory.zeroguess.ai";

const TOTAL_STEPS = 4;

/* ------------------------------------------------------------------ */
/*  Step 1 — Welcome                                                  */
/* ------------------------------------------------------------------ */
function StepWelcome({ onNext }: { onNext: () => void }) {
  const cards = [
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
          />
        </svg>
      ),
      title: "Live Factory",
      description:
        "8 CNC machines, injection molding, assembly \u2014 running 24/7 with real data",
    },
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
          />
        </svg>
      ),
      title: "AI Agents",
      description:
        "Chat with AI that understands factory operations. Ask anything.",
    },
    {
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0"
          />
        </svg>
      ),
      title: "Challenges",
      description:
        "6 challenges from beginner to expert. Test your manufacturing AI skills.",
    },
  ];

  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-4xl sm:text-5xl font-bold text-[#fafafa] mb-4">
        Welcome to{" "}
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage: "linear-gradient(135deg, #ff9500, #ff5722)",
          }}
        >
          OpenShopFloor
        </span>
      </h1>
      <p className="text-lg text-[#a1a1aa] max-w-xl mb-12">
        Your Manufacturing AI Playground is ready. Let&apos;s take a quick tour.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-3xl mb-12">
        {cards.map((card) => (
          <div
            key={card.title}
            className="rounded-xl p-6 text-left transition-all duration-200 hover:scale-[1.03]"
            style={{
              background: "#111114",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div className="text-[#ff9500] mb-4">{card.icon}</div>
            <h3 className="text-[#fafafa] font-semibold text-lg mb-2">
              {card.title}
            </h3>
            <p className="text-[#71717a] text-sm leading-relaxed">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="px-8 py-3 rounded-lg font-semibold text-white text-lg transition-all duration-200 hover:scale-105 cursor-pointer"
        style={{
          backgroundImage: "linear-gradient(135deg, #ff9500, #ff5722)",
        }}
      >
        Let&apos;s Go &rarr;
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Meet Your Factory                                        */
/* ------------------------------------------------------------------ */
function StepFactory({ onNext }: { onNext: () => void }) {
  const [iframeLoaded, setIframeLoaded] = useState(false);

  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-4xl sm:text-5xl font-bold text-[#fafafa] mb-4">
        Your Factory is Running
      </h1>
      <p className="text-lg text-[#a1a1aa] max-w-xl mb-10">
        Real-time production data &mdash; OEE, orders, stock levels, machine
        status.
      </p>

      <div
        className="relative w-full max-w-4xl rounded-xl overflow-hidden mb-10"
        style={{
          background: "#111114",
          border: "1px solid rgba(255,255,255,0.06)",
          aspectRatio: "16 / 9",
        }}
      >
        {!iframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "#ff9500", borderTopColor: "transparent" }}
            />
            <span className="text-[#a1a1aa] text-sm animate-pulse">
              Connecting to factory&hellip;
            </span>
          </div>
        )}
        <iframe
          src={FACTORY_URL}
          title="Factory Dashboard"
          className="w-full h-full"
          style={{ opacity: iframeLoaded ? 1 : 0, transition: "opacity 0.5s" }}
          onLoad={() => setIframeLoaded(true)}
        />
      </div>

      <button
        onClick={onNext}
        className="px-8 py-3 rounded-lg font-semibold text-white text-lg transition-all duration-200 hover:scale-105 cursor-pointer"
        style={{
          backgroundImage: "linear-gradient(135deg, #ff9500, #ff5722)",
        }}
      >
        Cool! What&apos;s next? &rarr;
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3 — Your First Question                                      */
/* ------------------------------------------------------------------ */
function StepFirstQuestion({ onNext }: { onNext: () => void }) {
  const router = useRouter();
  const [customQuestion, setCustomQuestion] = useState("");

  const suggestedQuestions = [
    "What's the current OEE of all machines?",
    "Are there any orders at risk of being late?",
    "Show me the current stock levels",
  ];

  const askQuestion = useCallback(
    (prompt: string) => {
      router.push(`/chat?prompt=${encodeURIComponent(prompt)}`);
    },
    [router]
  );

  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-4xl sm:text-5xl font-bold text-[#fafafa] mb-4">
        Talk to Your Factory AI
      </h1>
      <p className="text-lg text-[#a1a1aa] max-w-xl mb-10">
        Ask a question about the factory. Pick one below or type your own.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl mb-8">
        {suggestedQuestions.map((q) => (
          <button
            key={q}
            onClick={() => askQuestion(q)}
            className="rounded-xl p-5 text-left transition-all duration-200 hover:scale-[1.03] cursor-pointer group"
            style={{
              background: "#111114",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span className="text-[#ff9500] text-sm font-medium block mb-2 group-hover:text-[#ff5722] transition-colors">
              Try asking&hellip;
            </span>
            <span className="text-[#fafafa] text-sm leading-relaxed">
              &ldquo;{q}&rdquo;
            </span>
          </button>
        ))}
      </div>

      <div
        className="flex w-full max-w-xl rounded-xl overflow-hidden mb-10"
        style={{
          background: "#111114",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <input
          type="text"
          value={customQuestion}
          onChange={(e) => setCustomQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customQuestion.trim()) {
              askQuestion(customQuestion.trim());
            }
          }}
          placeholder="Or type your own question..."
          className="flex-1 bg-transparent px-5 py-3 text-[#fafafa] placeholder-[#71717a] outline-none text-sm"
        />
        <button
          onClick={() => {
            if (customQuestion.trim()) askQuestion(customQuestion.trim());
          }}
          disabled={!customQuestion.trim()}
          className="px-5 py-3 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: "#ff9500" }}
        >
          Ask &rarr;
        </button>
      </div>

      <button
        onClick={onNext}
        className="text-[#71717a] hover:text-[#a1a1aa] text-sm transition-colors cursor-pointer"
      >
        Skip &mdash; I&apos;ll ask later &rarr;
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4 — You're Ready                                             */
/* ------------------------------------------------------------------ */
function StepReady() {
  const router = useRouter();

  const actions = [
    {
      title: "Start a Chat",
      description: "Ask the AI anything about the factory",
      href: "/chat",
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
          />
        </svg>
      ),
    },
    {
      title: "Take a Challenge",
      description: "Test your skills with real manufacturing scenarios",
      href: "/challenges",
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0"
          />
        </svg>
      ),
    },
    {
      title: "Build a Flow",
      description: "Create visual AI workflows",
      href: "/flows",
      icon: (
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
      ),
    },
  ];

  const handleFinish = () => {
    localStorage.setItem(LS_ONBOARDING_DONE, "true");
    router.push("/dashboard");
  };

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6">
        <svg
          className="w-16 h-16 text-[#ff9500]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.746 3.746 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
          />
        </svg>
      </div>
      <h1 className="text-4xl sm:text-5xl font-bold text-[#fafafa] mb-4">
        You&apos;re All Set!
      </h1>
      <p className="text-lg text-[#a1a1aa] max-w-xl mb-12">
        Your playground is ready. Here&apos;s what to do next:
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-3xl mb-12">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            onClick={() =>
              localStorage.setItem(LS_ONBOARDING_DONE, "true")
            }
            className="rounded-xl p-6 text-left transition-all duration-200 hover:scale-[1.03] group no-underline"
            style={{
              background: "#111114",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div className="text-[#ff9500] mb-4 group-hover:text-[#ff5722] transition-colors">
              {action.icon}
            </div>
            <h3 className="text-[#fafafa] font-semibold text-lg mb-1">
              {action.title}
            </h3>
            <p className="text-[#71717a] text-sm">{action.description}</p>
          </Link>
        ))}
      </div>

      <button
        onClick={handleFinish}
        className="px-8 py-3 rounded-lg font-semibold text-white text-lg transition-all duration-200 hover:scale-105 cursor-pointer"
        style={{
          backgroundImage: "linear-gradient(135deg, #ff9500, #ff5722)",
        }}
      >
        Go to Dashboard &rarr;
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Progress dots                                                     */
/* ------------------------------------------------------------------ */
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="w-2.5 h-2.5 rounded-full transition-all duration-300"
          style={{
            background:
              i === current
                ? "#ff9500"
                : i < current
                ? "rgba(255,149,0,0.4)"
                : "rgba(255,255,255,0.12)",
            transform: i === current ? "scale(1.3)" : "scale(1)",
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                         */
/* ------------------------------------------------------------------ */
export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [animating, setAnimating] = useState(false);
  const [visible, setVisible] = useState(true);

  // Auth guard + onboarding-done guard
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (localStorage.getItem(LS_ONBOARDING_DONE) === "true") {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  const goToStep = useCallback(
    (next: number) => {
      if (animating) return;
      setDirection(next > step ? "forward" : "backward");
      setAnimating(true);
      setVisible(false);

      setTimeout(() => {
        setStep(next);
        setVisible(true);
        setTimeout(() => setAnimating(false), 300);
      }, 200);
    },
    [step, animating]
  );

  const nextStep = useCallback(() => {
    if (step < TOTAL_STEPS - 1) goToStep(step + 1);
  }, [step, goToStep]);

  // Show nothing while checking auth
  if (loading || !user) return null;

  const stepContent = [
    <StepWelcome key="welcome" onNext={nextStep} />,
    <StepFactory key="factory" onNext={nextStep} />,
    <StepFirstQuestion key="question" onNext={nextStep} />,
    <StepReady key="ready" />,
  ];

  return (
    <div
      className="relative min-h-screen flex flex-col"
      style={{ background: "#050507" }}
    >
      <BackgroundOrbs />

      {/* Top bar: progress dots + skip */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-6">
        <ProgressDots current={step} total={TOTAL_STEPS} />
        <Link
          href="/dashboard"
          onClick={() =>
            localStorage.setItem(LS_ONBOARDING_DONE, "true")
          }
          className="text-[#71717a] hover:text-[#a1a1aa] text-sm transition-colors no-underline"
        >
          Skip
        </Link>
      </header>

      {/* Step content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 sm:px-10 pb-16">
        <div
          className="w-full max-w-4xl transition-all duration-300 ease-out"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible
              ? "translateX(0)"
              : direction === "forward"
              ? "translateX(40px)"
              : "translateX(-40px)",
          }}
        >
          {stepContent[step]}
        </div>
      </main>
    </div>
  );
}
