const base = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
let access = "",
  refresh = "";
let pending: Promise<boolean> | undefined;
export function setSession(tokens: {
  accessToken: string;
  refreshToken?: string;
}) {
  access = tokens.accessToken;
  refresh = tokens.refreshToken ?? "";
}
export function clearSession() {
  access = "";
  refresh = "";
}
async function renew() {
  if (!refresh) return false;
  try {
    const response = await fetch(base + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!response.ok) return false;
    setSession(await response.json());
    return true;
  } catch {
    return false;
  }
}
export async function webRequest<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  const send = () =>
    fetch(base + path, {
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
  if (response.status === 401 && !path.startsWith("/auth/")) {
    pending ??= renew();
    const ok = await pending;
    pending = undefined;
    if (ok) response = await send();
  }
  const body = await response.json();
  if (!response.ok)
    throw Error(
      Array.isArray(body.error?.message)
        ? body.error.message.join("; ")
        : (body.error?.message ?? "Не удалось выполнить запрос"),
    );
  return body;
}
export async function downloadReport(path: string, token: string) {
  const response = await fetch(base + path, {
    headers: { Authorization: `Bearer ${access || token}` },
  });
  if (!response.ok) throw Error("Не удалось выгрузить отчёт");
  return response.blob();
}
