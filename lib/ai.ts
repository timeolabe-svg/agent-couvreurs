// Helper IA centralisé — Gemini (Google AI Studio, palier gratuit)
// Remplace Anthropic pour réduire les coûts à 0€.
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

interface GeminiPart { text?: string }
interface GeminiCandidate { content?: { parts?: GeminiPart[] } }
interface GeminiResponse { candidates?: GeminiCandidate[] }

/**
 * Génère du texte via Gemini. Interface unique pour tout l'agent.
 * @param system  Instruction système (persona, règles)
 * @param prompt  Message utilisateur
 * @param maxTokens  Plafond de sortie
 * @param temperature  Créativité (0 = déterministe, ~0.9 = créatif)
 */
export async function generateText(params: {
  system?: string
  prompt: string
  maxTokens?: number
  temperature?: number
}): Promise<string> {
  if (!GEMINI_KEY) {
    throw new Error('GEMINI_API_KEY not set')
  }

  const body = {
    ...(params.system ? { systemInstruction: { parts: [{ text: params.system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
    generationConfig: {
      maxOutputTokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.8,
      // Désactive le "thinking" de Gemini 2.5 (sinon il consomme le budget de sortie)
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  // RÉESSAIS sur défaillances TRANSITOIRES (429 rate-limit du palier gratuit, 5xx, réponse
  // vide). Sur un burst de réponses, Gemini renvoyait ponctuellement 429/vide → l'appel jetait
  // et le lead chaud était perdu. On tente jusqu'à 3 fois avec un court backoff ; on ne jette
  // qu'après épuisement (le générateur a de toute façon un repli déterministe en dernier recours).
  // Clé en HEADER (x-goog-api-key), jamais en query string (fuite logs). Timeout 20s/appel.
  let lastErr = 'unknown'
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt)) // 0ms, 500ms, 1000ms
    let res: Response
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        }
      )
    } catch (e) {
      lastErr = `fetch ${String((e as Error)?.message ?? e).slice(0, 60)}`
      continue // timeout/réseau → on retente
    }
    if (!res.ok) {
      lastErr = `Gemini API error: ${res.status}`
      // 429 (quota) et 5xx = transitoires → retenter ; 4xx (hors 429) = définitif → stop.
      if (res.status === 429 || res.status >= 500) continue
      throw new Error(lastErr)
    }
    const data = (await res.json()) as GeminiResponse
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (text.trim()) return text
    lastErr = 'Gemini returned empty text'
    // vide (souvent MAX_TOKENS/blocage ponctuel) → on retente
  }
  throw new Error(lastErr)
}

/** Nettoyage OBLIGATOIRE des emails générés (Gemini ignore parfois les consignes) :
 *  - supprime les tirets cadratins/moyens (— –) marqueurs IA
 *  - supprime tout placeholder non rempli ([Nom concurrent], [ville]...)
 *  - rétablit une ponctuation propre */
export function cleanEmailText(s: string): string {
  let t = s
    .replace(/\s*[—–]\s*/g, ', ')                       // tirets IA → virgule
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')                  // supprime les placeholders [xxx]
    .replace(/\b(comme|tels que|tel que)\s+ou\b/gi, '') // résidu "comme  ou"
    .replace(/\bou\s+(\.|,|\?)/gi, '$1')                // résidu "ou ."
    .replace(/\(\s*\)/g, '')                            // parenthèses vides
    .replace(/ +([.,])/g, '$1')                         // espace avant virgule/point (FR garde l'espace avant ? ! : ;)
    .replace(/,\s*,/g, ',')                             // double virgule
    .replace(/[ \t]{2,}/g, ' ')                         // espaces multiples
    .replace(/\n{3,}/g, '\n\n')                         // sauts de ligne multiples
  return t.trim()
}

/** Extrait le premier objet JSON d'une réponse texte (robuste aux ```json ... ```
 *  et au texte parasite après le JSON : on équilibre les accolades au lieu d'une
 *  regex gourmande qui casse si Gemini ajoute "{smiley}" ou du texte après). */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '')
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in AI response')

  // Scan en équilibrant { } (en ignorant les accolades dans les chaînes "...").
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') inStr = !inStr
    else if (!inStr) {
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T
      }
    }
  }
  // Repli : tentative gourmande (JSON tronqué) — lèvera si invalide.
  const lastBrace = cleaned.lastIndexOf('}')
  if (lastBrace > start) return JSON.parse(cleaned.slice(start, lastBrace + 1)) as T
  throw new Error('No balanced JSON object found in AI response')
}
