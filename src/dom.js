/** The formatting and clipboard helpers the pages share. */

export const fmtInt = n => Number(n).toLocaleString("en-US");

export const fmtBytes = b => {
  if (!Number.isFinite(b)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1000 && i < units.length - 1) {
    b /= 1000;
    i++;
  }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${units[i]}`;
};

export const fmtDate = iso => (iso
  ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"})
  : "—");

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button?.classList.add("done");
    setTimeout(() => button?.classList.remove("done"), 1200);
  } catch { /* clipboard blocked; the text is still selectable */ }
}
