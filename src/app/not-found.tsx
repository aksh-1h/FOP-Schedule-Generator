import Link from "next/link";
export default function NotFound() {
  return (
    <main className="page-loading">
      <h1>Page not found</h1>
      <Link href="/college">Return to colleges</Link>
    </main>
  );
}
