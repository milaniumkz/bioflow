import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Удаление аккаунта Collection",
  description: "Как запросить удаление аккаунта и связанных данных в Collection.",
};

const supportEmail = "milaniumkz@yandex.kz";

export default function CollectionAccountDeletionPage() {
  return (
    <main lang="ru" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", lineHeight: 1.6 }}>
      <h1>Удаление аккаунта Collection</h1>
      <ol>
        <li>Напишите на <a href={`mailto:${supportEmail}?subject=Collection%20account%20deletion`}>{supportEmail}</a> с запросом на удаление аккаунта Collection и связанных данных.</li>
        <li>Укажите номер телефона аккаунта и название организации, если оно известно. Не отправляйте пароль, коды входа или QR рейсов.</li>
        <li>Поддержка может запросить подтверждение, что аккаунт принадлежит вам, и сообщит результат обработки запроса.</li>
      </ol>
      <p>Запрос относится к профилю, контактным данным, учётным данным для входа, сеансам и регистрации устройства для уведомлений. Записи о рабочих операциях и аудите могут сохраняться, если они нужны для безопасности или соблюдения обязательных требований. Срок такого хранения зависит от назначения записи и применимых требований.</p>
      <p><a href="/collection/privacy">Политика конфиденциальности Collection</a></p>
    </main>
  );
}
