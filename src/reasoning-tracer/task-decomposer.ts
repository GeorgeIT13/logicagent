/**
 * Task decomposition for complex requests.
 *
 * Splits multi-step user messages into independent subtasks,
 * each of which gets its own trace linked via `subtaskOf`.
 *
 * Initial implementation uses heuristic pattern matching
 * (numbered lists, "then"/"and then", sequential markers).
 */

export interface Subtask {
  /** Human-readable description of the subtask. */
  description: string;
  /** Original position index (0-based). */
  index: number;
}

export interface DecompositionResult {
  /** Whether the input was decomposed (false = single-step, no decomposition). */
  decomposed: boolean;
  subtasks: Subtask[];
}

// Numbered list: "1. do X\n2. do Y" or "1) do X\n2) do Y"
const NUMBERED_LIST_RE = /^\s*\d+[.)]\s+/gm;

// "then" / "and then" / "after that" / "next" as step separators
const SEQUENTIAL_MARKERS = [
  /\bthen\b/i,
  /\band then\b/i,
  /\bafter that\b/i,
  /\bnext,?\s/i,
  /\bfinally\b/i,
  /\bfirst\b.*\bthen\b/is,
];

/**
 * Analyze a user message and decompose into subtasks if multi-step.
 *
 * Returns `{ decomposed: false, subtasks: [] }` for single-step requests.
 * Decomposition is deliberately conservative — only splits on clear structural markers.
 */
export function decomposeTask(input: string): DecompositionResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { decomposed: false, subtasks: [] };
  }

  // Try numbered list decomposition first (strongest signal)
  const numberedResult = tryNumberedListDecomposition(trimmed);
  if (numberedResult) {
    return numberedResult;
  }

  // Try sequential marker decomposition
  const sequentialResult = trySequentialDecomposition(trimmed);
  if (sequentialResult) {
    return sequentialResult;
  }

  return { decomposed: false, subtasks: [] };
}

function tryNumberedListDecomposition(input: string): DecompositionResult | null {
  const matches = input.match(NUMBERED_LIST_RE);
  if (!matches || matches.length < 2) {
    return null;
  }

  // Split on numbered list items
  const parts = input.split(/^\s*\d+[.)]\s+/m).filter((p) => p.trim());
  if (parts.length < 2) {
    return null;
  }

  return {
    decomposed: true,
    subtasks: parts.map((part, index) => ({
      description: part.trim().replace(/\n+/g, " "),
      index,
    })),
  };
}

function trySequentialDecomposition(input: string): DecompositionResult | null {
  // Only attempt if the input has sequential markers
  const hasSequentialMarkers = SEQUENTIAL_MARKERS.some((re) => re.test(input));
  if (!hasSequentialMarkers) {
    return null;
  }

  // Split on sentence boundaries near sequential markers.
  // Split on ". Then", ", then", "; then", ". After that", ". Next,", ". Finally"
  const splitRe =
    /[.;,]\s+(?:then|and then|after that|next,?\s|finally)\b/i;
  const parts = input.split(splitRe).filter((p) => p.trim());

  if (parts.length < 2) {
    return null;
  }

  return {
    decomposed: true,
    subtasks: parts.map((part, index) => ({
      description: part.trim().replace(/\n+/g, " "),
      index,
    })),
  };
}
