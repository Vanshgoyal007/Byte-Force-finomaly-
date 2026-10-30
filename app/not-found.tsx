import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container" style={{ padding: '80px 24px', maxWidth: '600px' }}>
      <h1 style={{ marginBottom: '16px' }}>Page not found</h1>
      <p className="text-muted" style={{ marginBottom: '24px' }}>
        The page you requested does not exist or may have been moved.
      </p>
      <Link href="/" className="btn btn-primary">
        Return to overview
      </Link>
    </main>
  );
}
