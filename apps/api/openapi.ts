import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Config, Step, Track } from "../../packages/shared/contracts.js";
export function installApiContract(app: FastifyInstance, origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const publicReads = [
    "/v1/status",
    "/v1/me",
    "/v1/live",
    "/v1/worlds/",
    "/v1/leaderboard",
    "/v1/seasons",
    "/v1/players/",
    "/v1/streamers/",
    "/v1/shop",
    "/v1/quests",
    "/v1/raids",
    "/v1/factions",
    "/v1/cards/",
  ];
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/v1/") || route.url === "/v1/openapi.json")
      return;
    for (const method of Array.isArray(route.method)
      ? route.method
      : [route.method]) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      const path = route.url.replace(/:([A-Za-z]+)/g, "{$1}");
      const publicRead =
        method === "GET" &&
        publicReads.some(
          (p) =>
            route.url === p || (p.endsWith("/") && route.url.startsWith(p)),
        );
      const operation: Record<string, unknown> = {
        operationId: `${method.toLowerCase()}_${route.url.replace(/[^A-Za-z0-9]+/g, "_")}`,
        description: route.url.startsWith("/v1/cards/")
          ? "Requires the owner-consented, signed, unexpired card token in the path. Privacy and revocation are checked on every request."
          : route.url.includes("/creator/")
            ? "Requires owning creator identity."
            : route.url.includes("/admin/")
              ? "Requires an explicit ADMIN_TWITCH_IDS allowlist match."
              : "See docs/API.md and docs/SETUP.md for identity, timing and pagination semantics.",
        parameters: [...route.url.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
          name: m[1],
          in: "path",
          required: true,
          schema: { type: "string" },
        })),
        security:
          publicRead || route.url === "/v1/demo/session"
            ? []
            : route.url === "/v1/twitch/eventsub"
              ? [{ twitchSignature: [] }]
              : route.url.startsWith("/v1/native/")
                ? [{ captureToken: [] }]
                : route.url === "/v1/debug/pair"
                  ? []
                  : method === "GET"
                    ? [{ sessionCookie: [] }]
                    : [{ sessionCookie: [], csrfHeader: [] }],
        responses: {
          "200": {
            description:
              "Successful response; some mutation endpoints return 204 or a provider redirect.",
          },
          "400": {
            description: "Invalid request or game rule rejection",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "401": { description: "Authentication required" },
          "403": {
            description: "Origin, CSRF, ownership or permission rejected",
          },
          "429": { description: "Actor/world request budget exceeded" },
        },
      };
      if (method !== "GET") {
        let schema: unknown = { type: "object" };
        if (route.url.endsWith("/actions"))
          schema = {
            type: "object",
            additionalProperties: false,
            required: ["prompt", "clientRequestId"],
            properties: {
              prompt: { type: "string", minLength: 1, maxLength: 500 },
              clientRequestId: { type: "string", minLength: 1, maxLength: 100 },
              targetHint: { type: "string", maxLength: 80 },
            },
          };
        if (method === "PATCH" && route.url === "/v1/creator/config")
          schema = { $ref: "#/components/schemas/CreatorConfig" };
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema } },
        };
      }
      paths[path] ||= {};
      paths[path][method.toLowerCase()] = operation;
    }
  });
  app.get("/v1/openapi.json", async () => ({
    openapi: "3.1.0",
    info: {
      title: "RaidRift API",
      version: "0.2.0",
      description:
        "Implemented endpoint inventory generated from registered routes. Some less common request/response shapes are intentionally documented as generic objects; consult source validators. WebSocket signaling is documented separately.",
    },
    servers: [{ url: origin }],
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "rr_session" },
        csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
        twitchSignature: {
          type: "apiKey",
          in: "header",
          name: "Twitch-Eventsub-Message-Signature",
          description:
            "HMAC over message ID + timestamp + exact raw body; all three Twitch headers and a fresh timestamp are required.",
        },
        captureToken: { type: "http", scheme: "bearer" },
      },
      schemas: {
        CreatorConfig: z.toJSONSchema(Config),
        ActionStep: z.toJSONSchema(Step),
        SceneTrack: z.toJSONSchema(Track),
        Error: {
          type: "object",
          required: ["code", "message", "requestId"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            requestId: { type: "string" },
          },
        },
      },
    },
  }));
}
