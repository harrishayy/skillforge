import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ErrorToast } from "@/components/ui/ErrorToast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SkillForge — AI-Powered Skill Training",
  description: "Expert recordings transformed into interactive annotated workflows, powered by NVIDIA Nemotron and Claude AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorToast />
        {children}
      </body>
    </html>
  );
}
