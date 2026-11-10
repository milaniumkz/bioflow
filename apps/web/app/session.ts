import { mobileNotify } from "./mobile-bridge.ts";
const base = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
let epoch = 0;
let access = "",
  refresh = "";
let pending: Promise<boolean> | undefined;
let restoring: Promise<string | undefined> | undefined;
async function browserRequest(path: string, init: RequestInit = {}) {
  const send = () =>
    networkFetch(base + path, {
      ...init,
      method: "POST",
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("bioflow:browser-session", send);
  return send();
}
export function setSession(
  tokens: {
    accessToken: string;
    refreshToken?: string;
  },
  preserveIdentity = false,
) {
  if (!preserveIdentity) epoch++;
  access = tokens.accessToken;
  refresh = tokens.refreshToken ?? "";
  if (!preserveIdentity && typeof window !== "undefined") {
    try {
      localStorage.removeItem("bioflow:logged-out");
    } catch {}
  }
  mobileNotify({ action: "session", sessionId: currentSessionId() });
}
export function clearSession() {
  epoch++;
  access = "";
  refresh = "";
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("bioflow:logged-out", "1");
    } catch {}
    void browserRequest("/auth/browser-logout").catch(() => {});
  }
  mobileNotify({ action: "sessionEnded" });
}
async function renew() {
  const generation = epoch;
  try {
    const response = refresh
      ? await networkFetch(base + "/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: refresh }),
        })
      : await browserRequest("/auth/browser-refresh");
    if (!response.ok) return false;
    const tokens = await response.json();
    if (generation !== epoch) return false;
    const subject = (value: string) => {
      try {
        return JSON.parse(
          atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        ).sub;
      } catch {
        return undefined;
      }
    };
    if (
      subject(access) &&
      subject(tokens.accessToken) &&
      subject(access) !== subject(tokens.accessToken)
    ) {
      setSession(tokens);
      if (typeof window !== "undefined")
        window.dispatchEvent(
          new CustomEvent("bioflow:identity-changed", {
            detail: { accessToken: tokens.accessToken },
          }),
        );
      return false;
    }
    setSession(tokens, true);
    return true;
  } catch {
    throw Error(
      "Нет связи с сервером. Проверьте подключение и повторите попытку.",
    );
  }
}
export function restoreBrowserSession(): Promise<string | undefined> {
  restoring ??= restoreBrowserSessionOnce().finally(() => {
    restoring = undefined;
  });
  return restoring;
}
async function restoreBrowserSessionOnce(): Promise<string | undefined> {
  if (typeof window !== "undefined") {
    try {
      if (localStorage.getItem("bioflow:logged-out")) return undefined;
    } catch {}
  }
  const generation = epoch;
  const response = await browserRequest("/auth/browser-refresh");
  if (generation !== epoch) return undefined;
  if (response.status === 401 || response.status === 403) return undefined;
  if (!response.ok)
    throw Error("Не удалось восстановить вход. Повторите попытку.");
  const tokens = await response.json();
  if (generation !== epoch) return undefined;
  setSession(tokens, true);
  return tokens.accessToken;
}
export async function networkFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    return await fetch(input, init);
  } catch {
    throw Error(
      "Нет связи с сервером. Проверьте подключение и повторите попытку.",
    );
  }
}
async function sessionFetch(
  path: string,
  token?: string,
  init: RequestInit = {},
) {
  const requestEpoch = epoch;
  const checkIdentity = () => {
    if (requestEpoch !== epoch)
      throw Error(
        "Пользователь изменился. Повторите действие в текущей сессии.",
      );
  };
  const send = () =>
    networkFetch(base + path, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(access || token
          ? { Authorization: `Bearer ${access || token}` }
          : {}),
        ...init.headers,
      },
    });
  let response = await (path === "/auth/browser-login"
    ? browserRequest(path, init)
    : send());
  checkIdentity();
  if (
    response.status === 401 &&
    (!path.startsWith("/auth/") || path === "/auth/me")
  ) {
    const renewing = (pending ??= renew());
    let ok;
    try {
      ok = await renewing;
    } finally {
      if (pending === renewing) pending = undefined;
    }
    if (ok) response = await send();
  }
  return { response, checkIdentity };
}

export async function webRequest<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  const form =
    typeof document === "undefined"
      ? undefined
      : document.activeElement?.closest("form, .formGrid");
  const { response, checkIdentity } = await sessionFetch(path, token, init);
  let body;
  try {
    body = await response.json();
  } catch {
    throw Error("Сервер временно недоступен. Повторите попытку.");
  }
  checkIdentity();
  if (
    response.status === 401 &&
    path !== "/auth/login" &&
    path !== "/auth/refresh" &&
    !path.startsWith("/auth/browser-") &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("bioflow:expired"));
  if (!response.ok)
    throw Error(
      response.status === 429
        ? "Слишком много запросов. Подождите минуту и повторите попытку."
        : Array.isArray(body.error?.message)
          ? body.error.message.map(readableError).join("; ")
          : readableError(
              body.error?.message ??
                body.message ??
                "Не удалось выполнить запрос",
            ),
    );
  if (
    init.method &&
    init.method !== "GET" &&
    !path.startsWith("/files/") &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(
      new CustomEvent("bioflow:saved", { detail: { form } }),
    );
  return body;
}
export async function downloadReport(path: string, token: string) {
  const { response, checkIdentity } = await sessionFetch(path, token);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("bioflow:expired"));
    let message = "Не удалось выгрузить отчёт. Повторите попытку.";
    try {
      const body = await response.json();
      message = readableError(body.error?.message ?? body.message ?? message);
    } catch {}
    checkIdentity();
    throw Error(
      response.status === 429
        ? "Слишком много запросов. Подождите минуту и повторите попытку."
        : message,
    );
  }
  const blob = await response.blob();
  checkIdentity();
  const format = new URL(path, "http://localhost").searchParams.get("format");
  if (format === "pdf" && (await blob.slice(0, 5).text()) !== "%PDF-")
    throw Error("Сервер не сформировал PDF. Повторите попытку.");
  if (format === "xlsx" && (await blob.slice(0, 2).text()) !== "PK")
    throw Error("Сервер не сформировал таблицу. Повторите попытку.");
  if (blob.type.includes("text/html") || blob.type.includes("application/json"))
    throw Error("Сервер не сформировал файл отчёта. Повторите попытку.");
  checkIdentity();
  return blob;
}

function readableError(message: string): string {
  const messages: Record<string, string> = {
    "Email or phone is required": "Укажите email или телефон",
    "Current password is invalid": "Неверный текущий пароль",
    "Session revoked": "Сессия отозвана. Войдите снова.",
    "Invalid or expired bearer token": "Сессия истекла. Войдите снова.",
    "User is blocked or missing": "Пользователь заблокирован или недоступен",
    "Insufficient permissions": "Недостаточно прав для этого действия",
    "Invalid credentials": "Неверный логин или пароль",
    "Unsupported file type":
      "Неподдерживаемый формат файла. Используйте JPEG, PNG, WebP или PDF.",
    "Internal server error":
      "Ошибка сервера. Повторите попытку или обратитесь к администратору.",
    "Too Many Requests":
      "Слишком много запросов. Подождите и повторите попытку.",
    Unauthorized: "Сессия завершена. Войдите снова.",
    Forbidden: "Недостаточно прав для этого действия",
  };
  if (messages[message]) return messages[message];
  if (message.startsWith("fileIds must contain"))
    return "Добавьте хотя бы одну фотографию или документ";
  if (message.includes("should not be empty"))
    return "Заполните обязательные поля";
  if (/^[a-zA-Z][a-zA-Z0-9.]* (must|should) /.test(message)) {
    if (message.startsWith("email ")) return "Укажите корректный email";
    if (message.includes("Password ") || message.startsWith("password "))
      return "Проверьте пароль: он должен содержать не менее 8 символов";
    return "Проверьте обязательные поля и формат введённых данных";
  }
  if (/[A-Za-z]/.test(message) && !/[А-Яа-яЁё]/.test(message))
    return "Не удалось выполнить действие. Проверьте данные и доступ к партии.";
  return message.replace(/\bc[a-z0-9]{20,}\b/gi, "указанная запись");
}

export function currentSessionId(): string | undefined {
  try {
    return JSON.parse(
      atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ).sessionId;
  } catch {
    return undefined;
  }
}
