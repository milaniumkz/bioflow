import { Socket } from "net";

export async function checkRedis(redisUrl = process.env.REDIS_URL, timeoutMs = 500) {
  if (!redisUrl) return { configured: false, ok: false };
  const url = new URL(redisUrl);
  const port = Number(url.port || 6379);
  const host = url.hostname;

  return new Promise<{ configured: true; ok: boolean }>((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve({ configured: true, ok });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}
