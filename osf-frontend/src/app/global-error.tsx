'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#888', fontSize: '14px', marginBottom: '24px' }}>
              {error.message || 'A critical error occurred.'}
            </p>
            <button
              onClick={reset}
              style={{
                background: '#ff9500',
                color: '#0a0a0a',
                padding: '10px 20px',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
