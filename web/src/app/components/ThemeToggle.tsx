'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('osf-theme');
    if (stored === 'light') {
      setDark(false);
    } else if (stored === 'dark') {
      setDark(true);
    } else {
      // default to system preference
      setDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    localStorage.setItem('osf-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--border)] transition-colors"
      aria-label="Toggle theme"
    >
      {dark ? '\u2600\uFE0F Light' : '\uD83C\uDF19 Dark'}
    </button>
  );
}
