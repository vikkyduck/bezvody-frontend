/**
 * Сохранение файла из ответа сервера. Только браузер.
 *
 * Сервер отдаёт файл строкой в base64 — так он проходит тем же путём, что и
 * остальные ответы, без отдельного адреса и отдельной проверки прав.
 * Здесь строка снова становится файлом и уезжает в «Загрузки».
 */
export function saveFile(name: string, base64: string, mime = "application/octet-stream"): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
