/**
 * Hybrid voice intent matcher: regex (primary) + optional fuzzy for ASR typos.
 * Covers phrases like "next step", "skip", "go to the next phase", "previous step", "go back".
 */

export type VoiceIntent = "next" | "prev" | "finish" | null;

const NEXT_PATTERN =
  /(?:^|\s)(?:next|skip|continue|advance|moving\s+on|go\s*(?:to\s*)?(?:the\s*)?next)\s*(?:step|phase|part|stage)?(?:\s|$)|(?:^|\s)(?:next|skip|continue)\s*(?:\s|$)/i;
const PREV_PATTERN =
  /(?:^|\s)(?:previous|back|go\s*back|last|prior)\s*(?:step|phase|part|stage)?(?:\s|$)|(?:^|\s)(?:go\s*back|previous)\s*(?:\s|$)/i;
const FINISH_PATTERN =
  /(?:^|\s)(?:finish|done|complete|that'?s\s*it|done\s+with\s+this|end\s*recording|stop\s*recording)(?:\s|$)/i;

const NEXT_SEEDS = ["next step", "next", "skip", "continue", "advance", "go to next phase"];
const PREV_SEEDS = ["previous step", "previous", "back", "go back"];
const FINISH_SEEDS = ["finish", "done", "complete", "end recording", "stop recording"];

const LLM_FALLBACK_MIN_LENGTH = 50;

function normalizeForFuzzy(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

const FUZZY_THRESHOLD = 2;

function fuzzyMatchIntent(text: string): VoiceIntent {
  const normalized = normalizeForFuzzy(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let bestIntent: VoiceIntent = null;
  let bestDist = Infinity;

  for (const seed of NEXT_SEEDS) {
    const d = levenshtein(normalized, seed);
    if (d <= FUZZY_THRESHOLD && d < bestDist) {
      bestDist = d;
      bestIntent = "next";
    }
  }
  for (const seed of PREV_SEEDS) {
    const d = levenshtein(normalized, seed);
    if (d <= FUZZY_THRESHOLD && d < bestDist) {
      bestDist = d;
      bestIntent = "prev";
    }
  }
  for (const seed of FINISH_SEEDS) {
    const d = levenshtein(normalized, seed);
    if (d <= FUZZY_THRESHOLD && d < bestDist) {
      bestDist = d;
      bestIntent = "finish";
    }
  }

  return bestIntent;
}

/**
 * Match transcript to voice intent using regex (primary) and optional fuzzy matching.
 */
export function matchVoiceIntent(
  transcript: string,
  options?: { useFuzzy?: boolean }
): VoiceIntent {
  const text = transcript.trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  if (NEXT_PATTERN.test(lower)) return "next";
  if (PREV_PATTERN.test(lower)) return "prev";
  if (FINISH_PATTERN.test(lower)) return "finish";

  if (options?.useFuzzy) {
    return fuzzyMatchIntent(text);
  }

  return null;
}

/**
 * Returns true when transcript is long enough and primary matcher returned null,
 * so the client may call the LLM fallback API.
 */
export function shouldUseLLMFallback(transcript: string): boolean {
  return transcript.trim().length >= LLM_FALLBACK_MIN_LENGTH;
}
