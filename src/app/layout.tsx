import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FOP · Timetable studio",
  description: "Faculty of Pharmacy academic scheduling",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
