import type { WorldSnapshot } from "./contracts.js";
export const defaultConfig: WorldSnapshot["config"] = {
  title: "The Violet Frontier",
  public: true,
  paused: false,
  vision: false,
  audio: 0.08,
  density: 65,
  maxPlayers: 200,
  reducedMotion: false,
  ai: false,
  chaos: "standard",
  geometry: {
    width: 1920,
    height: 1080,
    crop: [0, 0, 0, 0],
    mirror: false,
    rotation: "0",
    viewport: [0, 0, 1, 1],
  },
};
