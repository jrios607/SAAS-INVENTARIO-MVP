import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PageLayout } from "@/components/layout/PageLayout";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Panel Admin | SG BVC",
  description: "Sistema de Gestión Bodega, Vitrina y Caja",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} antialiased`}>
        <PageLayout>{children}</PageLayout>
      </body>
    </html>
  );
}
