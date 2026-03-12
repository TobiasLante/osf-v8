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
            <p style={{ color: '#888', fontSize: '14px', marginBottom: error.digest ? '8px' : '24px' }}>
              {error.message || 'A critical error occurred.'}
            </p>
            {error.digest && (
              <p style={{ color: '#666', fontSize: '12px', marginBottom: '24px', fontFamily: 'monospace' }}>
                Error ID: {error.digest}
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
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
              <a
                href="/dashboard"
                style={{
                  padding: '10px 20px',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  fontSize: '14px',
                  color: '#888',
                  textDecoration: 'none',
                }}
              >
                Dashboard
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
