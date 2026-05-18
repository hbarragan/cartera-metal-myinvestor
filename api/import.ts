import { requestHeaders } from "./lib/market.js";

function directDownloadUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("La URL debe empezar por http o https");
  }

  if (url.hostname.includes("drive.google.com")) {
    const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
    const id = fileMatch?.[1] ?? url.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  }

  return url.toString();
}

function maybeGoogleDriveConfirmUrl(html: string, originalUrl: string) {
  const action = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/i)?.[1];
  if (!action) return null;

  const url = new URL(action.replace(/&amp;/g, "&"), originalUrl);
  const inputs = [...html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)];
  inputs.forEach((match) => url.searchParams.set(match[1], match[2].replace(/&amp;/g, "&")));
  return url.toString();
}

async function fetchJsonFromUrl(rawUrl: string) {
  const url = directDownloadUrl(rawUrl);
  const first = await fetch(url, { headers: requestHeaders, redirect: "follow" });
  if (!first.ok) throw new Error(`No se pudo descargar el archivo: HTTP ${first.status}`);

  const text = await first.text();
  const confirmUrl = maybeGoogleDriveConfirmUrl(text, url);
  if (confirmUrl) {
    const confirmed = await fetch(confirmUrl, { headers: requestHeaders, redirect: "follow" });
    if (!confirmed.ok) throw new Error(`No se pudo confirmar la descarga: HTTP ${confirmed.status}`);
    return confirmed.json();
  }

  return JSON.parse(text);
}

export default async function handler(request: { url?: string; method?: string }, response: any) {
  try {
    if (request.method && request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.status(405).json({ error: "Metodo no permitido" });
      return;
    }

    const url = new URL(request.url ?? "", "https://local.app");
    const importUrl = url.searchParams.get("url")?.trim();
    if (!importUrl) {
      response.status(400).json({ error: "Falta el parametro url" });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(await fetchJsonFromUrl(importUrl));
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "No se pudo importar desde la URL",
    });
  }
}
