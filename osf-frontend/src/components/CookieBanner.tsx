'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const CONSENT_KEY = 'osf_consent';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match('(^|;)\\s*' + name + '=([^;]*)');
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days: number) {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getCookie(CONSENT_KEY)) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    setCookie(CONSENT_KEY, '1', 365);
    setVisible(false);
  };

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[100] w-[calc(100%-48px)] max-w-[620px] flex items-center gap-5 rounded-lg border border-border bg-surface/95 backdrop-blur-xl px-6 py-4 shadow-[0_8px_40px_rgba(0,0,0,0.5)] transition-all duration-500 ease-out ${
        visible
          ? '-translate-x-1/2 translate-y-0 opacity-100'
          : '-translate-x-1/2 translate-y-[120px] opacity-0 pointer-events-none'
      } max-sm:flex-col max-sm:text-center max-sm:gap-3.5 max-sm:bottom-4`}
    >
      <p className="flex-1 text-[13.5px] text-text-muted leading-relaxed">
        This site uses a cookie to remember your preferences. Analytics are anonymous and cookie-free.{' '}
        <Link href="/impressum" className="text-accent hover:underline">
          Privacy Policy
        </Link>
      </p>
      <button
        onClick={accept}
        className="px-5 py-2.5 rounded-lg bg-accent-gradient text-bg text-[13px] font-bold whitespace-nowrap hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(255,149,0,0.3)] transition-all"
      >
        OK
      </button>
    </div>
  );
}
