import { createCommandId } from "./command-id.mjs";
type MobileWindow = Window & {
  BioflowMobile?: { postMessage: (message: string) => void };
};

export function mobileNotify(message: Record<string, unknown>): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as MobileWindow).BioflowMobile;
  if (
    !bridge ||
    new URLSearchParams(window.location.search).get("mobile") !== "1"
  )
    return false;
  bridge.postMessage(JSON.stringify(message));
  return true;
}

export function isMobileWorkspace() {
  return (
    typeof window !== "undefined" &&
    !!(window as MobileWindow).BioflowMobile &&
    new URLSearchParams(window.location.search).get("mobile") === "1"
  );
}

let saving = false;
export async function saveBlob(
  blob: Blob,
  filename: string,
): Promise<"saved" | "cancelled" | "download-started"> {
  if (isMobileWorkspace()) {
    if (blob.size > 20 * 1024 * 1024)
      throw Error("Файл больше 20 МБ. Скачайте его через браузер.");

    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(Error("Не удалось подготовить файл"));
      reader.readAsDataURL(blob);
    });
    if (saving) throw Error("Дождитесь завершения предыдущего сохранения.");
    const requestId = createCommandId();
    saving = true;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        saving = false;
        clearTimeout(timer);
        window.removeEventListener("bioflow:file-result", receive);
        window.removeEventListener("bioflow:expired", expired);
      };
      const receive = (event: Event) => {
        const d = (event as CustomEvent).detail;
        if (d?.requestId !== requestId) return;
        cleanup();
        if (d.status === "saved") resolve("saved");
        else if (d.status === "cancelled") resolve("cancelled");
        else reject(Error("Не удалось сохранить файл. Повторите попытку."));
      };
      const expired = () => {
        cleanup();
        reject(
          Error(
            "Сессия завершена. Результат сохранения проверьте в выбранной папке.",
          ),
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          Error("Результат сохранения не получен. Проверьте выбранную папку."),
        );
      }, 300000);
      window.addEventListener("bioflow:file-result", receive);
      window.addEventListener("bioflow:expired", expired);
      if (
        !mobileNotify({
          action: "saveFile",
          requestId,
          data,
          filename,
          mime: blob.type,
        })
      ) {
        cleanup();
        reject(Error("Не удалось открыть сохранение файла."));
      }
    });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "download-started";
}

export function printQr(image: string) {
  if (!mobileNotify({ action: "printQr", image })) window.print();
}
