const base = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
let epoch = 0;
let access = "",
  refresh = "";
let pending: Promise<boolean> | undefined;
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
}
export function clearSession() {
  epoch++;
  access = "";
  refresh = "";
}
async function renew() {
  if (!refresh) return false;
  const generation = epoch;
  try {
    const response = await fetch(base + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
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
    return await fetch(input, init);
  } catch {
    throw Error(
      "Нет связи с сервером. Проверьте подключение и повторите попытку.",
    );
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
