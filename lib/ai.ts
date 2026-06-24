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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as GeminiResponse
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text.trim()) {
    throw new Error('Gemini returned empty text')
  }
  return text
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

/** Extrait le premier objet JSON d'une réponse texte (robuste aux ```json ... ```). */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '')
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in AI response')
  return JSON.parse(match[0]) as T
}
