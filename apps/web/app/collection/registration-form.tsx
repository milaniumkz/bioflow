"use client";
import { FormEvent, useEffect, useState } from "react";
import { webRequest } from "../session";

type Location = { id: string; name: string; kind: string };
export function RegistrationForm({
  onRegistered,
  onCancel,
}: {
  onRegistered(phone: string, password: string): Promise<void>;
  onCancel(): void;
}) {
  const [role, setRole] = useState("COLLECTOR");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void webRequest<{ locations: Location[] }>(
      "/collection/registration/options",
    )
      .then((data) => {
        if (active) {
          setLocations(data.locations);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const phone = String(data.get("phone"));
    const password = String(data.get("password"));
    try {
      await webRequest("/collection/registration", undefined, {
        method: "POST",
        body: JSON.stringify({
          fullName: String(data.get("fullName")),
          phone,
          password,
          role,
          ...(role !== "COLLECTOR" ? { locationId } : {}),
        }),
      });
      await onRegistered(phone, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="eyebrow">НОВАЯ УЧЁТНАЯ ЗАПИСЬ</p>
      <h1>Регистрация</h1>
      <label>
        Ваша роль
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setLocationId("");
          }}
        >
          <option value="COLLECTOR">Сборщик</option>
          <option value="WAREHOUSE_MANAGER">Мойка</option>
          <option value="FACTORY_MANAGER">Завод</option>
        </select>
      </label>
      {role !== "COLLECTOR" && (
        <label>
          {role === "WAREHOUSE_MANAGER" ? "Выберите мойку" : "Выберите завод"}
          <select
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Выберите из списка</option>
            {locations
              .filter(
                (l) =>
                  l.kind ===
                  (role === "WAREHOUSE_MANAGER" ? "WAREHOUSE" : "FACTORY"),
              )
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        ФИО
        <input
          name="fullName"
          autoComplete="name"
          minLength={2}
          maxLength={120}
          required
        />
      </label>
      <label>
        Номер телефона
        <input name="phone" type="tel" autoComplete="tel" required />
      </label>
      <label>
        Придумайте пароль
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          maxLength={128}
          required
        />
      </label>
      <button disabled={busy || !loaded}>
        {busy ? "Создаём аккаунт…" : "Зарегистрироваться и войти"}
      </button>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={onCancel}>
        Уже есть аккаунт — войти
      </button>
    </form>
  );
}
