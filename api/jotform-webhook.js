// api/jotform-webhook.js
import { randomUUID } from "node:crypto";

export const config = {
  api: { bodyParser: { type: "application/x-www-form-urlencoded", sizeLimit: "2mb" } },
};

// I tuoi "Field Details" di Jotform
const FILE_FIELD         = "caricaFile";             // Upload Photo
const NOME_COMUNE_FIELD  = "Identificazione_Specie"; // Nome comune
const NOME_SCIENT_FIELD  = "nomeScientifico";        // Nome scientifico
const AFFIDAB_FIELD      = "affidabilita";           // Affidabilità (es. "91%")
const ALLERGE_FIELD      = "allergenicita";          // Allergenicità
const CURIOSITA_FIELD    = "curiosita";              // Curiosità (opzionale)

// Mini-tabella indicativa di allergenicità per alcuni generi noti (puoi ampliarla/modificarla)
const ALLERGENICITY_BY_GENUS = {
  Ambrosia: "Altissima",
  Betula: "Alta",
  Cupressus: "Alta",
  Olea: "Alta",
  Platanus: "Alta",
  Poa: "Alta",      // graminacee
  Artemisia: "Media",
  Quercus: "Media",
  Pinus: "Media",
  Tilia: "Bassa",
  Rosa: "Bassa",
};

// Curiosità di esempio per qualche genere (facoltativo)
const CURIOSITA_BY_GENUS = {
  Quercus: "Legno usato tradizionalmente per botti e mobili.",
  Olea: "Specie simbolo del Mediterraneo; olio dai suoi frutti.",
  Tilia: "Fiori usati per tisane rilassanti.",
};

async function bufFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download fallito: ${url}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const submissionId = req.body?.submissionID || req.body?.submission_id;
    const rawFiles = req.body?.[FILE_FIELD] || "";
    const imageUrls = Array.isArray(rawFiles)
      ? rawFiles
      : String(rawFiles).split(",").map(s => s.trim()).filter(Boolean);

    if (!imageUrls.length) return res.status(400).send("Nessuna immagine nel payload.");

    // Prepara POST multipart per Pl@ntNet (no organs → modalità generale)
    const form = new FormData();
    for (const url of imageUrls.slice(0, 5)) {
      const buf = await bufFromUrl(url);
      const name = (url.split("/").pop() || `${randomUUID()}.jpg`).slice(0, 80);
      form.append("images", new Blob([buf]), name);
    }
    form.append("include-related-images", "false");
    form.append("lang", "it");

    const endpoint = `https://my-api.plantnet.org/v2/identify/all?api-key=${process.env.PLANTNET_API_KEY}`;
    const pnResp = await fetch(endpoint, { method: "POST", body: form });
    if (!pnResp.ok) throw new Error(`PlantNet error: ${pnResp.status}`);
    const data = await pnResp.json();

    const top = data?.results?.[0] || {};
    const species = top?.species || {};
    const sci = species.scientificName || species.scientificNameWithoutAuthor || "Specie non determinata";
    const common = (species.commonNames && species.commonNames[0]) || ""; // il primo nome comune disponibile
    const score = typeof top?.score === "number" ? Math.round(top.score * 100) : null;

    // Allergenicità: stima semplice basata sul Genere (prima parola del nome scientifico)
    const genus = sci.split(" ")[0] || "";
    const allerg = ALLERGENICITY_BY_GENUS[genus] || "Non nota";

    // Curiosità: messaggino breve se disponibile per il genere
    const curiosita = CURIOSITA_BY_GENUS[genus] || "";

    // Prepara aggiornamento per Jotform (5 campi)
    const submissionUpdate = {
      submission: {
        [NOME_COMUNE_FIELD]: common || "",
        [NOME_SCIENT_FIELD]: sci,
        [AFFIDAB_FIELD]: score !== null ? `${score}%` : "",
        [ALLERGE_FIELD]: allerg,
        [CURIOSITA_FIELD]: curiosita,
      },
    };

    if (submissionId && process.env.JOTFORM_API_KEY) {
      const jf = await fetch(`https://api.jotform.com/submission/${submissionId}`, {
        method: "POST",
        headers: { "APIKEY": process.env.JOTFORM_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(submissionUpdate),
      });
      if (!jf.ok) throw new Error(`Jotform update error: ${jf.status}`);
    }

    return res.status(200).json({ ok: true, species: sci, common, scorePercent: submissionUpdate.submission[AFFIDAB_FIELD] });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Errore integrazione Pl@ntNet/Jotform.");
  }
}

