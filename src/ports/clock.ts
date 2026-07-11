export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test double — advances only when told. */
export function fixedClock(iso: string): Clock {
  const d = new Date(iso);
  return { now: () => new Date(d) };
}
