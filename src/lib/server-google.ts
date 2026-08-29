/**
 * Выгрузка документов на Google Диск. Только сервер.
 *
 * Диск один — служебный, компании. Клиенту не нужно никуда входить: он
 * нажимает кнопку и получает ссылку на готовый Google-документ. Плата за это
 * удобство — документы клиентов лежат у нас, и это ответственность оператора,
 * а не Google.
 *
 * Ходим от имени сервисного аккаунта: подписываем JWT его ключом и меняем на
 * токен. Ключ лежит в secrets.json рядом с ключами моделей, наружу не
 * отдаётся никогда — как и они.
 *
 * Word и Excel заливаем с превращением в Google Документы и Таблицы: иначе на
 * Диске лежит файл, который надо скачивать, чтобы прочитать, — а просили ровно
 * обратного. Остальное (PDF, картинки) кладём как есть: превращать нечего.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

/** Ключ сервисного аккаунта — то, что Google отдаёт файлом при создании. */
export type ServiceAccount = {
  client_email: string;
  private_key: string;
};

/**
 * Доступ от имени живого аккаунта компании (OAuth).
 *
 * Появился не от хорошей жизни: Google отобрал у сервисных аккаунтов
 * собственное хранилище — папку они создать могут, а файл с содержимым уже
 * нет. Файлы должны принадлежать настоящему аккаунту, поэтому платформа
 * ходит от его имени по refresh-токену, выданному один раз.
 */
export type OAuthAccount = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export type GoogleSettings = {
  account: ServiceAccount | null;
  oauth: OAuthAccount | null;
  /** Папка на Диске, куда складывать. Пусто — корень Диска */
  folderId: string;
};

export type UploadResult =
  { ok: true; url: string; name: string; shared: string } | { ok: false; error: string };

/**
 * Токен живёт час; просим новый заранее, чтобы не упереться в отказ на
 * середине выгрузки. Держим в памяти процесса: перезапуск сервиса просто
 * получит новый.
 */
let cached: { token: string; until: number } | null = null;

/** Токен по refresh-токену живого аккаунта. */
async function oauthToken(oauth: OAuthAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: oauth.client_id,
      client_secret: oauth.client_secret,
      refresh_token: oauth.refresh_token,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Google не дал токен: ${res.status} ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google вернул ответ без токена");

  cached = {
    token: data.access_token,
    until: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return data.access_token;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;

  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64(head)}.${b64(claim)}`;
  const signature = createSign("RSA-SHA256")
    .update(body)
    .sign(account.private_key.replace(/\\n/g, "\n"), "base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${body}.${signature}`,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Google не дал токен: ${res.status} ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google вернул ответ без токена");

  // Минуту оставляем в запасе: между получением и загрузкой проходит время.
  cached = {
    token: data.access_token,
    until: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return data.access_token;
}

/** Во что превращать при заливке: Word — в документ, Excel — в таблицу. */
function googleType(mime: string, name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime.includes("wordprocessingml") || ext === "docx" || ext === "doc") {
    return "application/vnd.google-apps.document";
  }
  if (mime.includes("spreadsheetml") || ext === "xlsx" || ext === "xls" || ext === "csv") {
    return "application/vnd.google-apps.spreadsheet";
  }
  if (mime.includes("presentationml") || ext === "pptx" || ext === "ppt") {
    return "application/vnd.google-apps.presentation";
  }
  if (mime.startsWith("text/") || ext === "txt" || ext === "md") {
    return "application/vnd.google-apps.document";
  }
  // PDF, картинки и всё прочее — как есть: превращать нечего.
  return "";
}

/**
 * Залить файл и открыть к нему доступ.
 *
 * Доступ даём адресно, если у человека записана почта: тогда документ виден
 * ему и больше никому. Почты нет — открываем по ссылке, и об этом честно
 * сказано на кнопке: документ увидит любой, кому ссылка попадёт.
 */
export async function uploadToDrive(opts: {
  settings: GoogleSettings;
  name: string;
  mime: string;
  bytes: Buffer;
  /** Кому дать доступ. Пусто — доступ по ссылке */
  email?: string;
}): Promise<UploadResult> {
  const { account, oauth, folderId } = opts.settings;
  if (!account && !oauth) {
    return { ok: false, error: "Google Диск не подключён" };
  }

  try {
    // Живой аккаунт первичен: у сервисного нет своего хранилища.
    const token = oauth ? await oauthToken(oauth) : await accessToken(account!);
    const convert = googleType(opts.mime, opts.name);
    const meta: Record<string, unknown> = {
      name: opts.name,
      ...(folderId ? { parents: [folderId] } : {}),
      ...(convert ? { mimeType: convert } : {}),
    };

    // Multipart собираем руками: тело — метаданные плюс сам файл.
    const boundary = `bv${Math.random().toString(36).slice(2)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
          `--${boundary}\r\nContent-Type: ${opts.mime || "application/octet-stream"}\r\n\r\n`,
      ),
      opts.bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const up = await fetch(
      `${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body: body as unknown as BodyInit,
        signal: AbortSignal.timeout(120_000),
      },
    );

    const raw = await up.text();
    if (!up.ok) return { ok: false, error: driveError(up.status, raw) };
    const file = JSON.parse(raw) as { id?: string; webViewLink?: string };
    if (!file.id) return { ok: false, error: "Google принял файл, но не назвал его адрес" };

    const shared = await grant(token, file.id, opts.email?.trim() ?? "");

    return {
      ok: true,
      url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      name: opts.name,
      shared,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "не удалось" };
  }
}

/** Кому открыли документ — это же и показываем человеку. */
async function grant(token: string, fileId: string, email: string): Promise<string> {
  const body = email
    ? { type: "user", role: "writer", emailAddress: email }
    : { type: "anyone", role: "reader" };
  // Писем от нашего имени Google слать не должен: человек сам решит, кому
  // переслать ссылку.
  const res = await fetch(
    `${FILES_URL}/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    // Файл уже на Диске — молчать об этом нельзя, но и терять его незачем.
    return "доступ выдать не удалось — документ пока виден только служебному аккаунту";
  }
  return email ? `доступ открыт для ${email}` : "доступ по ссылке: откроет любой, у кого она есть";
}

function driveError(status: number, raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    const msg = j.error?.message ?? "";
    if (/storage quota|quota/i.test(msg)) {
      return "на служебном Диске кончилось место — очистите папку или подключите общий диск";
    }
    if (status === 404) return "папка на Диске не найдена — проверьте её адрес в настройке";
    if (status === 403) {
      return "служебному аккаунту не дали доступ к папке — поделитесь ею с его почтой как редактор";
    }
    if (msg) return `${status}: ${msg.slice(0, 160)}`;
  } catch {
    /* не JSON — покажем как есть */
  }
  return `${status}: ${raw.slice(0, 160) || "Google не объяснил причину"}`;
}
