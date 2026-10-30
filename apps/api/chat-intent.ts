/** Complete, bounded ordinary-chat intents. Unknown conversation never invokes paid AI. */
export function chatIntent(input: string): string | null {
  if (!input.trim().startsWith("!") && /^[wasd]$/i.test(input.trim()))
    return null;
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^!(rift|ourapp)\s+/, "")
    .replace(/^!/, "")
    .replace(/[.!?,]+$/, "")
    .trim();
  if (!text || text.length > 500 || text.includes("@")) return null;
  const parts = text.split(
    /\s*(?:;|,?\s+then\s+|\s+and then\s+|\s+потім\s+|\s+а потім\s+|\s+затем\s+)\s*/,
  );
  if (parts.length > 4) return null;
  const out: string[] = [];
  const phrases: Record<string, string[]> = {
    join: [
      "join",
      "join in",
      "i want to join",
      "приєднатись",
      "приєднатися",
      "приєднайся",
    ],
    up: [
      "w",
      "up",
      "forward",
      "go forward",
      "walk forward",
      "move forward",
      "walk away",
      "go away",
      "відійди",
      "йди вперед",
      "іди вперед",
      "вперед",
    ],
    down: [
      "s",
      "down",
      "back",
      "backward",
      "go back",
      "walk back",
      "move back",
      "come closer",
      "come here",
      "walk towards me",
      "підійди ближче",
      "підійди сюди",
      "йди назад",
      "іди назад",
      "назад",
    ],
    jump: [
      "jump",
      "hop",
      "jump up",
      "do a jump",
      "стрибни",
      "підстрибни",
      "пригни",
      "прыгни",
    ],
    dance: [
      "dance",
      "start dancing",
      "do a dance",
      "танцюй",
      "потанцюй",
      "танцуй",
    ],
    wave: [
      "wave",
      "say hello",
      "wave hello",
      "wave at me",
      "помахай",
      "помахай рукою",
      "привітайся",
    ],
    sit: ["sit", "sit down", "сядь", "сідай"],
    turn_left: [
      "turn_left",
      "turn left",
      "face left",
      "поверни ліворуч",
      "повернись ліворуч",
    ],
    turn_right: [
      "turn_right",
      "turn right",
      "face right",
      "поверни праворуч",
      "повернись праворуч",
    ],
    turn_around: [
      "turn_around",
      "turn around",
      "turn back",
      "повернись",
      "повернися",
      "розвернись",
      "розвернися",
    ],
    stop: [
      "stop",
      "stop moving",
      "stand",
      "stand up",
      "stay here",
      "стій",
      "зупинись",
      "зупинися",
      "встань",
      "стоп",
    ],
  };
  for (const raw of parts) {
    const s = raw
      .replace(/^(please|could you|can you|будь ласка|пожалуйста)\s+/, "")
      .replace(/\s+(please|будь ласка|пожалуйста)$/, "")
      .trim();
    const phrase = Object.entries(phrases).find(([, values]) =>
      values.includes(s),
    )?.[0];
    if (phrase) {
      out.push(phrase);
      continue;
    }
    if (
      s === "a" ||
      /^(?:(?:walk|go|move|step|head|run|sprint)\s+)?(?:to the )?left$/.test(
        s,
      ) ||
      /^(?:(?:йди|іди|піди|рухайся|біжи|иди)\s+)?(?:ліворуч|наліво|вліво|налево)$/.test(
        s,
      )
    ) {
      out.push(/^(run|sprint|біжи) /.test(s) ? "run left" : "left");
      continue;
    }
    if (
      s === "d" ||
      /^(?:(?:walk|go|move|step|head|run|sprint)\s+)?(?:to the )?right$/.test(
        s,
      ) ||
      /^(?:(?:йди|іди|піди|рухайся|біжи|иди)\s+)?(?:праворуч|направо|вправо)$/.test(
        s,
      )
    ) {
      out.push(/^(run|sprint|біжи) /.test(s) ? "run right" : "right");
      continue;
    }
    return null;
  }
  if (out.includes("join") && out.length !== 1) return null;
  return out.join(" then ");
}
