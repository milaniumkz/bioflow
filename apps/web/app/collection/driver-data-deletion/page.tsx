import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Удаление данных Collection Driver",
  description: "Как запросить удаление данных о поездках в Collection Driver.",
};

export default function DriverDataDeletionPage() {
  return (
    <main lang="ru" style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", lineHeight: 1.6 }}>
      <h1>Удаление данных Collection Driver</h1>
      <p>В Collection Driver нет отдельного аккаунта. Вы можете запросить удаление персональных данных, связанных с рейсом.</p>
      <ol>
        <li>Напишите на <a href="mailto:milaniumkz@yandex.kz?subject=Collection%20Driver%20data%20deletion">milaniumkz@yandex.kz</a>.</li>
        <li>Укажите номер телефона, использованный в рейсе, и номер рейса, если он известен. Не отправляйте QR-код или токен рейса.</li>
        <li>Поддержка может запросить подтверждение вашей связи с рейсом и сообщит, какие данные удалены и какие требуется сохранить.</li>
      </ol>
      <p>Запрос может охватывать номер телефона, номер автомобиля, координаты и прикреплённые фотографии. Записи, необходимые для безопасности, разрешения споров или соблюдения обязательных требований, могут храниться столько, сколько требуется для соответствующей цели.</p>
      <p><a href="/collection/privacy">Политика конфиденциальности Collection</a></p>
    </main>
  );
}
