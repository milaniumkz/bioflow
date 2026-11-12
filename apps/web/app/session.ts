import { mobileNotify } from "./mobile-bridge.ts";
const base = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
let epoch = 0;
let access = "",
  refresh = "";
let pending: Promise<boolean> | undefined;
let browserSession = false;
let restoring: Promise<string> | undefined;
const logoutMarker = "collection-web-signed-out";
const markedOut = () => {
  try {
    return window.localStorage.getItem(logoutMarker) === "1";
  } catch {
    return false;
  }
};
export function setSession(
  tokens: {
    accessToken: string;
    refreshToken?: string;
    browserSession?: boolean;
  },
  preserveIdentity = false,
) {
  if (!preserveIdentity) epoch++;
  access = tokens.accessToken;
  refresh = tokens.refreshToken ?? "";
  browserSession =
    tokens.browserSession ?? (preserveIdentity ? browserSession : false);
  if (browserSession) {
    try {
      window.localStorage.removeItem(logoutMarker);
    } catch {
      /* Optional sign-out flag only; tokens are never stored here. */
    }
  }
  mobileNotify({ action: "session", sessionId: currentSessionId() });
}
export function clearSession() {
  epoch++;
  access = "";
  refresh = "";
  browserSession = false;
  mobileNotify({ action: "sessionEnded" });
}
async function renew() {
  if (!refresh && !browserSession) return false;
  const generation = epoch;
  try {
    const response = await fetch(
      base + (browserSession ? "/auth/browser-session" : "/auth/refresh"),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(browserSession ? {} : { refreshToken: refresh }),
      },
    );
    if (!response.ok) return false;
    const tokens = await response.json();
    if (generation !== epoch) return false;
    setSession(tokens, true);
    return true;
  } catch {
    return false;
  }
}
export async function networkFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    return await fetch(input, { credentials: "include", ...init });
  } catch {
    throw Error(
      "Нет связи с сервером. Проверьте подключение и повторите попытку.",
    );
  }
}
export function restoreBrowserSession(): Promise<string> {
  if (access) return Promise.resolve(access);
  if (typeof window === "undefined" || markedOut()) return Promise.resolve("");
  if (restoring) return restoring;
  const generation = epoch;
  restoring = (async () => {
    try {
      const r = await networkFetch(base + "/auth/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      if (!r.ok || generation !== epoch) return "";
      const tokens = await r.json();
      if (generation !== epoch) return "";
      setSession(tokens);
      return tokens.accessToken as string;
    } catch {
      return "";
    } finally {
      restoring = undefined;
    }
  })();
  return restoring;
}
export async function endBrowserSession() {
  try {
    window.localStorage.setItem(logoutMarker, "1");
  } catch {
    /* No credentials are stored in browser storage. */
  }
  try {
    await networkFetch(base + "/auth/browser-logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    });
  } finally {
    clearSession();
  }
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
      headers: {
        "Content-Type": "application/json",
        ...(access || token
          ? { Authorization: `Bearer ${access || token}` }
          : {}),
        ...init.headers,
      },
    });
  let response = await send();
  checkIdentity();
  if (response.status === 401 && !path.startsWith("/auth/")) {
    pending ??= renew();
    const ok = await pending;
    pending = undefined;
    if (ok) response = await send();
  }
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
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("bioflow:expired"));
  if (!response.ok)
    throw Error(
      Array.isArray(body.error?.message)
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
  const response = await networkFetch(base + path, {
    headers: { Authorization: `Bearer ${access || token}` },
  });
  if (!response.ok) throw Error("Не удалось выгрузить отчёт");
  return response.blob();
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
  return message;
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
