// Live smoke test of the LLM-first planner with the phone's spatial tracks.
// npx tsx scripts/planner-smoke.ts --env-file E:/Hermes/.env   (prints plans and latency, never keys)
import { compileAI, aiProvider } from "../apps/api/compiler.js";
import { readEnvValue } from "../apps/api/tailnet-test.js";
import type { SceneTrack } from "../packages/shared/contracts.js";

const envFile = process.argv[process.argv.indexOf("--env-file") + 1];
if (envFile && !process.env.GROQ_API_KEY) process.env.GROQ_API_KEY = readEnvValue(envFile, "GROQ_API_KEY");
process.env.ALLOW_PAID_AI = "true";
process.env.AI_PROVIDER ||= "compat";
const track = (id: string, cls: string, box: [number, number, number, number]): SceneTrack =>
  ({ id, class: cls, attributes: [], box, confidence: 0.99, seenAt: Date.now(), source: "phone" }) as SceneTrack;
const fresh = () => [
  track("ph-there-1", "there", [0.45, 0.55, 0.1, 0.1]),
  track("ph-streamer-1", "streamer", [0.4, 0.9, 0.2, 0.1]),
  track("ph-portal-1", "portal", [0.6, 0.4, 0.2, 0.3]),
  track("ph-furniture-top-1", "furniture top", [0.1, 0.5, 0.3, 0.2]),
  track("ph-chair-1", "chair", [0.7, 0.5, 0.15, 0.25]),
  track("ph-spot-1", "spot 1", [0.2, 0.6, 0.06, 0.08]),
  track("ph-obj-7", "sofa", [0.05, 0.35, 0.4, 0.25]),
  track("ph-obj-9", "dog", [0.6, 0.7, 0.12, 0.1]),
  track("ph-spot-3", "spot 3", [0.7, 0.62, 0.06, 0.08]),
  track("ph-spot-5", "spot 5", [0.5, 0.4, 0.06, 0.08]),
];
const prompts = [
  "sit on the couch",
  "run to the puppy and dance",
  "go to 3",
  "jump on 5 then dance",
  "run to spot 1",
  "go to 4",
  "go to there",
  "go over there and dance",
  "come back to me then wave",
  "jump on the bed",
  "sit on the chair",
  "run to the portal, jump twice then cheer",
];
console.log("provider", JSON.stringify({ ...aiProvider(), key: undefined }));
for (const p of prompts) {
  const t0 = Date.now();
  try {
    const plan = await compileAI(p, fresh());
    console.log(`${Date.now() - t0} ms | ${p} -> ${plan.steps.map((s) => `${s.op}${s.name ? "(" + s.name + ")" : ""}${s.target ? "@" + s.target : ""}`).join(", ")}`);
  } catch (e: any) {
    console.log(`${Date.now() - t0} ms | ${p} -> ERROR ${e?.code ?? ""} ${e?.message ?? e}`);
  }
}
