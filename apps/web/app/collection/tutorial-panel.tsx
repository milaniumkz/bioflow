"use client";
import { tutorialMediaUrl } from "./tutorial-media";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import catalog from "./tutorial-catalog.json";
import { webRequest } from "../session";
import { saveBlob } from "../mobile-bridge";
const roleKeys: Record<string, string> = {
  OWNER: "owner",
  ADMIN: "owner",
  COLLECTOR: "collector",
  WAREHOUSE_MANAGER: "warehouse",
  FACTORY_MANAGER: "factory",
  DRIVER: "driver",
};
export function TutorialPanel({
  token = "",
  roles,
}: {
  token?: string;
  roles: string[];
}) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const driver = roles.length === 1 && roles[0] === "DRIVER";
  const list = useQuery({
    queryKey: ["collection-tutorials", token, roles.join(",")],
    queryFn: () =>
      webRequest<{ videos: { filename: string; url: string }[] }>(
        driver ? "/collection-driver/tutorials" : "/collection/tutorials",
        token,
      ),
    refetchInterval: 30000,
  });
  const visible = catalog.filter((v) =>
    roles.map((r) => roleKeys[r]).includes(v.role),
  );
  const ready = new Set(list.data?.videos.map((v) => v.filename));
  async function download(id: string) {
    setSaving(id);
    setError("");
    try {
      const response = await fetch(tutorialMediaUrl(id, "mp4"));
      if (!response.ok) throw Error();
      await saveBlob(await response.blob(), `${id}.mp4`);
    } catch {
      setError("Не удалось скачать видео. Проверьте интернет и повторите.");
    } finally {
      setSaving("");
    }
  }
  return (
    <section className="c-section">
      <h2>Видеоинструкции для вашей роли</h2>
      <p>
        Короткие пошаговые видео с женской озвучкой и подсветкой нажатий. В
        роликах используются учебные данные.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {list.isError ? (
        <p role="alert">Не удалось загрузить инструкции. Попробуйте позже.</p>
      ) : null}
      <div className="c-tutorial-grid">
        {visible
          .filter((v) => ready.has(v.id + ".mp4"))
          .map((v) => (
            <article key={v.id} className="c-card">
              <h3>{v.title}</h3>
              <video
                controls
                controlsList="nodownload noremoteplayback"
                onPlay={(event) => {
                  document.querySelectorAll("video").forEach((video) => {
                    if (video !== event.currentTarget) video.pause();
                  });
                }}
                playsInline
                preload="none"
                poster={tutorialMediaUrl(v.id, "jpg")}
                src={tutorialMediaUrl(v.id, "mp4")}
                aria-label={v.title}
              />
              <p>{v.steps[0]}</p>
              <button
                type="button"
                className="secondary"
                disabled={!!saving}
                onClick={() => void download(v.id)}
              >
                {saving === v.id ? "Скачиваем…" : "Скачать MP4"}
              </button>
            </article>
          ))}
      </div>
      {!visible.some((v) => ready.has(v.id + ".mp4")) && !list.isError ? (
        <p role="status">
          Инструкции для этой роли готовятся. Они появятся здесь после
          публикации.
        </p>
      ) : null}
    </section>
  );
}
export { catalog };
