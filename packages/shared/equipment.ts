import { catalog } from "./catalog.js";

export const equipmentSlots = ["skin", "hat", "pet"] as const;
export type EquipmentSlot = (typeof equipmentSlots)[number];
export type Equipment = Partial<Record<EquipmentSlot, string>>;

/** An explicit empty loadout wins over the deprecated single cosmetic field. */
export function equipmentOf(player: {
  equipment?: Equipment;
  cosmetic?: string;
}): Equipment {
  const result: Equipment = {};
  for (const slot of equipmentSlots) {
    const id =
      player.equipment !== undefined ? player.equipment[slot] : player.cosmetic;
    if (catalog.some((item) => item.id === id && item.slot === slot))
      result[slot] = id;
  }
  return result;
}

export function avatarColor(player: {
  equipment?: Equipment;
  cosmetic?: string;
  color: string;
}) {
  const skin = equipmentOf(player).skin;
  return catalog.find((item) => item.id === skin)?.color || player.color;
}
