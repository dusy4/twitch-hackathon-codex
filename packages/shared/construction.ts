export const buildingMaterials = [
  "riftstone",
  "moss",
  "amethyst",
  "sandstone",
] as const;
export type BuildingMaterial = (typeof buildingMaterials)[number];
export const buildingColors: Record<BuildingMaterial, string> = {
  riftstone: "#695f7e",
  moss: "#83bd99",
  amethyst: "#b296e4",
  sandstone: "#dfb68b",
};
export type CommunityBlock = {
  x: number;
  y: number;
  z: number;
  material: BuildingMaterial;
  ownerId: string | null;
};
export type CommunityStructure = {
  id: string;
  ownerId: string;
  title: string;
  x: number;
  y: number;
  revision: number;
  expiresAt: string;
  blocks: CommunityBlock[];
};
