import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Поддержка Collection",
};

export default function CollectionSupportPage() {
  return (
    <main lang="ru" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", lineHeight: 1.6 }}>
      <h1>Поддержка Collection и Collection Driver</h1>
      <p>
        По вопросам работы приложения напишите на{" "}
        <a href="mailto:milaniumkz@yandex.kz">milaniumkz@yandex.kz</a>.
        Укажите название приложения, модель устройства и опишите проблему.
        Не отправляйте пароль или QR-код рейса.
      </p>
      <ul>
        <li><a href="/collection/privacy">Политика конфиденциальности</a></li>
        <li><a href="/collection/account-deletion">Удаление аккаунта Collection</a></li>
        <li><a href="/collection/driver-data-deletion">Удаление данных Collection Driver</a></li>
      </ul>
    </main>
  );
}
