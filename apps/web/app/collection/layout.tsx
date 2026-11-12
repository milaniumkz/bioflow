import type { Metadata } from "next";
import type { ReactNode } from "react";
import { InstallPrompt } from "./install-prompt";
export const metadata: Metadata = {
  title: "Collection — рабочий контур",
  manifest: "/collection/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Collection",
    statusBarStyle: "default",
  },
  icons: { apple: "/collection-icons/icon-180.png" },
  description:
    "Сбор, склады, мойка, производство и доставка готовой продукции.",
};
export default function CollectionLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <InstallPrompt />
    </>
  );
}
