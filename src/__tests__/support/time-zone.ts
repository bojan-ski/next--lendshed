export const TEST_ZONES = ["UTC", "America/New_York", "Pacific/Auckland"];

export function useProcessTimeZone(zone: string) {
  const original = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = zone;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}
