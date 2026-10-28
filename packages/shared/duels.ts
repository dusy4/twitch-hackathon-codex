export type DuelMove = "cast" | "shield" | "charge" | "leave";
export type DuelState = {
  id: string;
  players: [string, string];
  health: [number, number];
  charge: [number, number];
  shield: [boolean, boolean];
  turn: string;
  revision: number;
  expires: number;
  status: "active" | "won" | "cancelled";
  winner: string | null;
  message: string;
};
