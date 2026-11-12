import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = {
  title: "Collection Driver — водитель",
  manifest: "/collection/driver/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Collection Driver",
    statusBarStyle: "default",
  },
};
export default function DriverLayout({ children }: { children: ReactNode }) {
  return children;
}
