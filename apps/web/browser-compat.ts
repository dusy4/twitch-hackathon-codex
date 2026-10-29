// getRandomValues is available on HTTP LAN pages; randomUUID requires a secure context.
export function clientRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the user-gesture copy operation on restricted browsers.
    }
  }
  const previous = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(field);
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    if (!document.execCommand("copy"))
      throw Error(
        "Clipboard unavailable. Select the field and copy it manually.",
      );
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}
