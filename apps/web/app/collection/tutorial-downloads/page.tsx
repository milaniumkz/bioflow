import catalog from "../tutorial-catalog.json";
import "../collection.css";
const roles: Record<string, string> = {
  owner: "Владелец",
  collector: "Сборщик",
  warehouse: "Склад",
  factory: "Завод",
  driver: "Водитель",
};
export default function Downloads() {
  return (
    <main className="collection-driver-route">
      <p className="eyebrow">COLLECTION · УЧЕБНЫЕ МАТЕРИАЛЫ</p>
      <h1>Скачать видеоинструкции</h1>
      <p>
        Отдельные MP4 с озвучкой и подсветкой нажатий. Внутри приложения каждой
        роли показываются только её ролики.
      </p>
      <a href="/downloads/tutorials/collection-tutorials.zip" download>
        Скачать все видео одним ZIP
      </a>
      {Object.entries(roles).map(([role, title]) => (
        <section className="c-section" key={role}>
          <h2>{title}</h2>
          <div className="c-list">
            {catalog
              .filter((v) => v.role === role)
              .map((v) => (
                <article className="c-card" key={v.id}>
                  <h3>{v.title}</h3>
                  <p>{v.steps[0]}</p>
                  <a href={`/downloads/tutorials/${v.id}.mp4`} download>
                    Скачать MP4
                  </a>
                </article>
              ))}
          </div>
        </section>
      ))}
    </main>
  );
}
