import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import type { Database, SQL } from "./db.js";
import type { World } from "./world.js";
import { GameError } from "./compiler.js";
import {
  buildingMaterials,
  type CommunityStructure,
  type CommunityBlock,
} from "../../packages/shared/construction.js";

const coordinate = z.number().int().min(0).max(7);
const address = {
  x: coordinate,
  y: z.number().int().min(0).max(5),
  z: coordinate,
};
const identity = { requestId: z.string().uuid() };
const selected = {
  structureId: z.string().uuid(),
  revision: z.number().int().positive(),
};
const Mutation = z.discriminatedUnion("kind", [
  z
    .object({
      ...identity,
      kind: z.literal("create"),
      title: z.string().trim().min(1).max(40),
      x: z.number().min(0.1).max(0.9),
      y: z.number().min(0.55).max(0.9),
    })
    .strict(),
  z
    .object({
      ...identity,
      ...selected,
      ...address,
      kind: z.literal("place"),
      material: z.enum(buildingMaterials),
    })
    .strict(),
  z
    .object({ ...identity, ...selected, ...address, kind: z.literal("remove") })
    .strict(),
  z.object({ ...identity, ...selected, kind: z.literal("delete") }).strict(),
]);
const structure = (row: Record<string, any>): CommunityStructure => ({
  id: row.id,
  ownerId: row.owner_id,
  title: row.title,
  x: row.x,
  y: row.y,
  revision: row.revision,
  expiresAt: new Date(row.expires_at).toISOString(),
  blocks: row.blocks,
});
export async function loadStructures(db: SQL, channel: string) {
  return (
    await db.query(
      "SELECT * FROM structures WHERE channel_id=$1 AND expires_at>now() ORDER BY id LIMIT 8",
      [channel],
    )
  ).rows.map(structure);
}
export function installConstruction(
  app: FastifyInstance,
  db: Database,
  auth: (req: FastifyRequest) => Record<string, any>,
  world: (id: string) => Promise<World>,
) {
  app.post("/v1/worlds/:id/construction", async (req) => {
    const who = auth(req),
      channelId = (req.params as { id: string }).id,
      mutation = Mutation.parse(req.body);
    const w = await world(channelId);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ channelId, mutation }))
      .digest("hex");
    const result = await db.transaction(async (tx) => {
      const actor = (
        await tx.query(
          "SELECT id FROM accounts WHERE id=$1 AND deleted=false FOR UPDATE",
          [who.id],
        )
      ).rows[0];
      if (!actor)
        throw new GameError("DELETED", "This account is unavailable", 403);
      // Serializes the room budget and config authorization across separate database connections.
      const channel = (
        await tx.query("SELECT * FROM channels WHERE id=$1 FOR UPDATE", [
          channelId,
        ])
      ).rows[0];
      if (!channel || (!channel.config.public && channel.owner_id !== who.id))
        throw new GameError("PRIVATE", "This world is private", 403);
      if (!channel.config.construction)
        throw new GameError(
          "BUILDING_DISABLED",
          "The creator has not enabled community construction",
          403,
        );
      if (channel.config.paused)
        throw new GameError("WORLD_PAUSED", "This world is paused", 409);
      if (!w.state.avatars.some((a) => a.id === who.id))
        throw new GameError(
          "JOIN_REQUIRED",
          "Enter this world before building",
          403,
        );
      if (
        (
          await tx.query(
            "SELECT 1 FROM bans WHERE channel_id=$1 AND account_id=$2",
            [channelId, who.id],
          )
        ).rows.length
      )
        throw new GameError("BANNED", "You cannot build in this world", 403);
      const previous = (
        await tx.query(
          "SELECT * FROM construction_receipts WHERE account_id=$1 AND request_id=$2",
          [who.id, mutation.requestId],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new GameError(
            "REQUEST_REUSED",
            "This request ID already belongs to a different operation",
            409,
          );
        const current = previous.result.structureId
          ? (
              await tx.query(
                "SELECT * FROM structures WHERE id=$1 AND channel_id=$2 AND expires_at>now()",
                [previous.result.structureId, channelId],
              )
            ).rows[0]
          : null;
        return {
          structure: current ? structure(current) : null,
          deletedId: previous.result.deletedId,
        };
      }
      const budget = (
        await tx.query(
          "SELECT count(*)::int AS daily,count(*) FILTER(WHERE created_at>now()-interval '1 second')::int AS burst FROM construction_receipts WHERE account_id=$1 AND created_at>now()-interval '24 hours'",
          [who.id],
        )
      ).rows[0];
      if (budget.daily >= 300 || budget.burst >= 3)
        throw new GameError(
          "BUILD_BUDGET",
          "Construction budget reached. Give the world a moment.",
          429,
        );
      let changed: CommunityStructure | null = null;
      if (mutation.kind === "create") {
        const room = (
          await tx.query(
            "SELECT owner_id FROM structures WHERE channel_id=$1 AND expires_at>now()",
            [channelId],
          )
        ).rows;
        if (room.length >= 8 || room.some((s) => s.owner_id === who.id))
          throw new GameError(
            "STRUCTURE_LIMIT",
            "Up to eight community structures and one per founder are allowed",
            409,
          );
        const blocks: CommunityBlock[] = [
          { x: 3, y: 0, z: 3, material: "riftstone", ownerId: who.id },
        ];
        changed = structure(
          (
            await tx.query(
              "INSERT INTO structures(id,channel_id,owner_id,title,x,y,blocks) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
              [
                randomUUID(),
                channelId,
                who.id,
                mutation.title,
                mutation.x,
                mutation.y,
                JSON.stringify(blocks),
              ],
            )
          ).rows[0],
        );
      } else {
        const row = (
          await tx.query(
            "SELECT * FROM structures WHERE id=$1 AND channel_id=$2 AND expires_at>now() FOR UPDATE",
            [mutation.structureId, channelId],
          )
        ).rows[0];
        if (!row)
          throw new GameError(
            "STRUCTURE_GONE",
            "This structure has expired or was removed",
            404,
          );
        if (row.revision !== mutation.revision)
          throw new GameError(
            "BUILD_CONFLICT",
            "Someone changed the structure. Review the latest blocks and try again.",
            409,
          );
        const moderator = channel.owner_id === who.id;
        if (mutation.kind === "delete") {
          if (!moderator && row.owner_id !== who.id)
            throw new GameError(
              "NOT_YOURS",
              "Only the founder or creator can remove this structure",
              403,
            );
          await tx.query("DELETE FROM structures WHERE id=$1", [row.id]);
        } else {
          const blocks = row.blocks as CommunityBlock[];
          const at = (dy = 0) =>
            blocks.find(
              (b) =>
                b.x === mutation.x &&
                b.y === mutation.y + dy &&
                b.z === mutation.z,
            );
          if (mutation.kind === "place") {
            if (at())
              throw new GameError(
                "CELL_OCCUPIED",
                "That cell already contains a block",
                409,
              );
            if (mutation.y > 0 && !at(-1))
              throw new GameError(
                "NEEDS_SUPPORT",
                "Build on the ground or on an existing block",
                409,
              );
            if (
              blocks.length >= 64 ||
              blocks.filter((b) => b.ownerId === who.id).length >= 16
            )
              throw new GameError(
                "BLOCK_LIMIT",
                "Up to 64 blocks per structure and 16 per contributor are allowed",
                409,
              );
            blocks.push({
              x: mutation.x,
              y: mutation.y,
              z: mutation.z,
              material: mutation.material,
              ownerId: who.id,
            });
          } else {
            const block = at();
            if (!block)
              throw new GameError(
                "EMPTY_CELL",
                "There is no block at that cell",
                404,
              );
            if (!moderator && block.ownerId !== who.id)
              throw new GameError(
                "NOT_YOURS",
                "You can remove your own blocks; the creator can moderate every block",
                403,
              );
            if (at(1))
              throw new GameError(
                "SUPPORT_IN_USE",
                "Remove the blocks above this one first",
                409,
              );
            blocks.splice(blocks.indexOf(block), 1);
          }
          changed = structure(
            (
              await tx.query(
                "UPDATE structures SET blocks=$2,revision=revision+1 WHERE id=$1 RETURNING *",
                [row.id, JSON.stringify(blocks)],
              )
            ).rows[0],
          );
        }
      }
      const response = {
        structure: changed,
        deletedId: mutation.kind === "delete" ? mutation.structureId : null,
      };
      await tx.query(
        "INSERT INTO construction_receipts(account_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)",
        [
          who.id,
          mutation.requestId,
          fingerprint,
          JSON.stringify({
            structureId: changed?.id || null,
            deletedId: response.deletedId,
          }),
        ],
      );
      return response;
    });
    w.state.structures = await loadStructures(db, channelId);
    w.event("construction.changed", {
      structureId: result.structure?.id || result.deletedId,
    });
    return result;
  });
}
