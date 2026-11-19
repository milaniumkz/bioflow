import type { Metadata } from "next";
import { AccountDeletion } from "./deletion-form";

export const metadata: Metadata = {
  title: "Удаление аккаунта Collection",
  description: "Удаление аккаунта и данных профиля в Collection.",
};

export default function CollectionAccountDeletionPage() {
  return (
    <main lang="ru">
      <AccountDeletion />
    </main>
  );
}
