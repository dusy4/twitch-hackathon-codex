/**
 * Open-vocabulary target words: matching chat nouns ("the plant", "boxes",
 * "sofa") against track classes ("potted plant", "box", "couch") and pulling
 * candidate object nouns out of a chat request for the server detector.
 */

/** Canonical class -> words viewers use for it (COCO names first). */
const SYNONYMS: Record<string, string[]> = {
  couch: ["sofa", "settee"],
  "potted plant": ["plant", "houseplant", "pot plant", "flowerpot"],
  "dining table": ["table"],
  tv: ["television", "telly"],
  "cell phone": ["phone", "smartphone", "mobile phone"],
  dog: ["doggo", "doggy", "puppy", "pup"],
  cat: ["kitty", "kitten"],
  person: ["human", "guy", "man", "woman", "someone"],
  bicycle: ["bike"],
  motorcycle: ["motorbike"],
  cup: ["mug"],
  laptop: ["computer"],
  "teddy bear": ["teddy", "plushie"],
  "sports ball": ["ball"],
  "wine glass": ["glass"],
  box: ["crate", "carton"],
};
const REVERSE = new Map<string, string>();
for (const [cls, words] of Object.entries(SYNONYMS))
  for (const w of words) if (!REVERSE.has(w)) REVERSE.set(w, cls);

export const normalizeWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-#]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Everything a viewer might call a track of this class. */
export function classForms(cls: string): string[] {
  const c = normalizeWords(cls);
  if (!c) return [];
  const forms = new Set([c, ...(SYNONYMS[c] || [])]);
  const words = c.split(" ");
  if (words.length > 1) forms.add(words[words.length - 1]);
  const canonical = REVERSE.get(c);
  if (canonical) {
    forms.add(canonical);
    for (const w of SYNONYMS[canonical]) forms.add(w);
  }
  return [...forms];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pluralRe = (form: string) =>
  `${escape(form).replace(/ /g, "\\s+")}${/y$/.test(form) ? "|" + escape(form.slice(0, -1)) + "ies" : ""}(?:s|es)?`;

/** Index of the first mention of a class (or its synonyms/plurals) in text, or -1. */
export function mentionIndex(cls: string, text: string): number {
  const t = normalizeWords(text);
  let best = -1;
  for (const form of classForms(cls)) {
    const m = new RegExp(`(?:^|\\s)(?:${pluralRe(form)})(?=\\s|$)`).exec(t);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
}
export const mentions = (cls: string, text: string) =>
  mentionIndex(cls, text) >= 0;

const DETERMINERS = new Set([
  "the",
  "a",
  "an",
  "that",
  "this",
  "those",
  "these",
  "some",
  "my",
  "your",
  "another",
]);
/** Words that end a noun phrase. */
const STOP = new Set([
  "and",
  "then",
  "or",
  "with",
  "to",
  "on",
  "onto",
  "in",
  "into",
  "at",
  "behind",
  "near",
  "by",
  "beside",
  "under",
  "over",
  "for",
  "of",
  "it",
  "while",
  "so",
  "please",
  "again",
  "too",
  "now",
  "quickly",
  "fast",
  "slowly",
  "around",
  "next",
  "from",
  "up",
  "down",
  "like",
  "is",
  "are",
  "there",
  "here",
  "real",
  "very",
  "you",
  "me",
  "we",
  "can",
  "if",
  "but",
  "as",
  "top",
  "front",
  "side",
  "until",
  "before",
  "after",
  "toward",
  "towards",
  "across",
  "through",
  "off",
  "out",
  "inside",
  "outside",
  "above",
  "below",
  "between",
  "against",
  "along",
  "past",
]);
/** Phrases that are never camera objects. */
const NOT_OBJECTS = new Set([
  "rift",
  "portal",
  "dragon",
  "tiny dragon",
  "castle",
  "confetti",
  "dance",
  "moves",
  "way",
  "air",
  "ground",
  "floor",
  "left",
  "right",
  "middle",
  "center",
  "end",
  "stream",
  "chat",
  "camera",
  "world",
  "scene",
  "room",
  "time",
  "music",
  "beat",
  "song",
  "party",
  "show",
  "crowd",
  "streamer",
  "viewers",
  "viewer",
  "group",
  "spot",
  "place",
  "thing",
  "object",
  "one",
]);
export const singular = (word: string) =>
  /(ss|us|is)$/.test(word) || word.length <= 3
    ? word
    : /ies$/.test(word)
      ? word.slice(0, -3) + "y"
      : /(x|ch|sh|ss|z)es$/.test(word)
        ? word.slice(0, -2)
        : /s$/.test(word)
          ? word.slice(0, -1)
          : word;

/**
 * Object nouns named with a determiner ("sit on the wooden crate" ->
 * ["wooden crate"], "hide behind the boxes" -> ["box"]). Max three, each <= 40 chars.
 */
export function targetNouns(prompt: string): string[] {
  const words = normalizeWords(prompt.replace(/^!(rift|ourapp)\s+/i, "")).split(
    " ",
  );
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!DETERMINERS.has(words[i])) continue;
    const phrase: string[] = [];
    for (let j = i + 1; j < words.length && phrase.length < 3; j++) {
      if (STOP.has(words[j]) || DETERMINERS.has(words[j])) break;
      phrase.push(words[j]);
    }
    if (!phrase.length) continue;
    phrase[phrase.length - 1] = singular(phrase[phrase.length - 1]);
    const noun = phrase.join(" ").slice(0, 40).trim();
    if (
      noun.length >= 2 &&
      !NOT_OBJECTS.has(noun) &&
      !NOT_OBJECTS.has(phrase[phrase.length - 1]) &&
      !out.includes(noun)
    )
      out.push(noun);
    if (out.length >= 3) break;
  }
  return out;
}
