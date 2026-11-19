"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { networkFetch } from "../../session";
import "./deletion.css";

const base = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
type Props = {
  token?: string;
  accountName?: string;
  onDeleted?: () => void;
  onCancel?: () => void;
};

async function request(
  path: string,
  method: string,
  body: object,
  token?: string,
) {
  const response = await networkFetch(base + path, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Не удалось подтвердить аккаунт. Проверьте логин и действующий пароль."
        : "Не удалось удалить аккаунт. Повторите попытку.",
    );
  return result;
}

export function AccountDeletion({
  token,
  accountName,
  onDeleted,
  onCancel,
}: Props) {
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [reviewing, setReviewing] = useState(false);
  const [name, setName] = useState(accountName ?? ""),
    [verifiedToken, setVerifiedToken] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleted, setDeleted] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !confirmed) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (!reviewing) {
        if (!token) {
          const identifier = login.trim();
          const result = await request("/auth/login", "POST", {
            ...(identifier.includes("@")
              ? { email: identifier }
              : { phone: identifier }),
            password,
          });
          if (!active.current) return;
          setVerifiedToken(result.accessToken);
          const response = await networkFetch(base + "/auth/me", {
            headers: { Authorization: `Bearer ${result.accessToken}` },
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Повторите вход в аккаунт.");
          const profile = await response.json();
          if (!active.current) return;
          setName(
            `${profile.fullName} (${profile.email || profile.phone || identifier})`,
          );
        }
        setReviewing(true);
      } else {
        await request(
          "/auth/account",
          "DELETE",
          { currentPassword: password, confirmation: "DELETE" },
          token || verifiedToken,
        );
        if (!active.current) return;
        setPassword("");
        setVerifiedToken("");
        setLogin("");
        setDeleted(true);
        onDeleted?.();
      }
    } catch (cause) {
      if (!active.current) return;
      setError(cause instanceof Error ? cause.message : "Повторите попытку.");
      if (!token) {
        setVerifiedToken("");
        setReviewing(false);
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (deleted)
    return (
      <section className="account-deletion" role="status">
        <h2>Аккаунт удалён</h2>
        <p>Данные профиля и входа удалены. Все сеансы завершены.</p>
        <a href="/collection">Вернуться ко входу</a>
      </section>
    );
  return (
    <section className="account-deletion">
      <h2>Удаление аккаунта Collection</h2>
      <p>
        Удаление необратимо. Имя, телефон, email, пароль, устройства, сеансы
        входа и персональные уведомления будут удалены сразу.
      </p>
      <p>
        Накладные, складские операции и журналы безопасности организации
        сохраняются для учёта и аудита. В ссылках на автора профиля будет
        указано «Deleted account». Данные других сотрудников и остатки не
        изменятся.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        {reviewing ? (
          <>
            <p>
              <strong>Удаляемый аккаунт: {name}</strong>
            </p>
            <p>
              Подтвердите окончательное удаление. Восстановить этот аккаунт
              будет нельзя.
            </p>
          </>
        ) : (
          <>
            {token ? (
              <p>
                Аккаунт: <strong>{accountName}</strong>
              </p>
            ) : (
              <label>
                Телефон или email
                <input
                  name="login"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={login}
                  disabled={busy}
                  onChange={(event) => setLogin(event.target.value)}
                />
              </label>
            )}
            <label>
              Действующий пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="deletion-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Я понимаю, что аккаунт будет удалён без возможности восстановления
            </label>
          </>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <div className="deletion-actions">
          <button type="submit" disabled={busy || !confirmed}>
            {busy
              ? "Обработка…"
              : reviewing
                ? "Удалить аккаунт навсегда"
                : "Продолжить"}
          </button>
          {reviewing ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReviewing(false);
                setVerifiedToken("");
                setError("");
              }}
            >
              Назад
            </button>
          ) : onCancel ? (
            <button type="button" disabled={busy} onClick={onCancel}>
              Отмена
            </button>
          ) : (
            <a href="/collection">Отмена</a>
          )}
        </div>
      </form>
      <p>
        <a href="/collection/privacy">Политика конфиденциальности</a>
      </p>
    </section>
  );
}
