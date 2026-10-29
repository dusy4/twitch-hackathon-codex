/** Normalized portal threshold, shared by server arrivals and every renderer aspect ratio. */
export const PORTAL_FOOT = [0.36, 0.77] as const;
export type AvatarArrival = {
  from: [number, number];
  to: [number, number];
  startedAt: number;
  durationMs: number;
};
export function arrivalPosition(
  arrival: AvatarArrival,
  now: number,
): [number, number] {
  const progress = Math.max(
    0,
    Math.min(1, (now - arrival.startedAt) / arrival.durationMs),
  );
  const eased = progress * progress * (3 - 2 * progress);
  return [
    arrival.from[0] + (arrival.to[0] - arrival.from[0]) * eased,
    arrival.from[1] + (arrival.to[1] - arrival.from[1]) * eased,
  ];
}
export function makeArrival(slot: number, now: number): AvatarArrival {
  return {
    from: [...PORTAL_FOOT],
    to: [0.56 + (slot % 6) * 0.06, 0.79 + (Math.floor(slot / 6) % 5) * 0.025],
    startedAt: now + (slot % 5) * 100,
    durationMs: 1500,
  };
}
