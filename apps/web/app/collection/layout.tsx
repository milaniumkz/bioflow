import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = {
  title: "Collection — рабочий контур",
  description:
    "Сбор, склады, мойка, производство и доставка готовой продукции.",
};
export default function CollectionLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
