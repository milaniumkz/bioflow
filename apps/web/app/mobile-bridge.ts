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

export async function saveBlob(blob: Blob, filename: string) {
  if (isMobileWorkspace()) {
    if (blob.size > 20 * 1024 * 1024)
      throw Error("Файл больше 20 МБ. Скачайте его через браузер.");

    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(Error("Не удалось подготовить файл"));
      reader.readAsDataURL(blob);
    });
    mobileNotify({ action: "saveFile", data, filename, mime: blob.type });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printQr(image: string) {
  if (!mobileNotify({ action: "printQr", image })) window.print();
}
