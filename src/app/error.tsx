"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="page-loading">
      <h1>Something went wrong</h1>
      <p>Please try loading this page again.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
