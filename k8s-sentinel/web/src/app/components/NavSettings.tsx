'use client';

import { useState } from 'react';
import NotificationSettings from './NotificationSettings';

export default function NavSettings() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
        title="Notification settings"
      >
        Settings
      </button>
      {open && <NotificationSettings onClose={() => setOpen(false)} />}
    </>
  );
}
