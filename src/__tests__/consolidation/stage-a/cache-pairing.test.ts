import { readSource, sourceFiles } from "@/__tests__/support/import-graph";

// The cached-reads registry in project-data.md lists forecast rows; a row is live
// once its data-layer function exists in src/data/. Stage A has none, so nothing may
// be cached, tagged or revalidated. Spec 08 (getCategories / `categories`) turns this
// into the real pairing test: each live row's tags read by a `cacheTag` in its
// function and invalidated by every action the row names.

type RegistryRow = { read: string; tags: string[]; revalidatedBy: string[] };

const CACHE_APIS = [
  "use cache",
  "cacheTag",
  "cacheLife",
  "updateTag",
  "revalidateTag",
  "revalidatePath",
  "unstable_cache",
];

const names = (cell: string) =>
  [...cell.matchAll(/`([^`]+)`/g)].map(([, name]) => name);

// The rows of the table under "### Cached Reads (tag registry)".
function registryRows(): RegistryRow[] {
  const section =
    readSource("context/project-data.md").split(
      "### Cached Reads (tag registry)",
    )[1] ?? "";
  const rows: RegistryRow[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    const read = /^`(\w+)`$/.exec(cells[1] ?? "")?.[1];
    if (read) {
      rows.push({
        read,
        tags: names(cells[2]),
        revalidatedBy: names(cells[4]),
      });
    }
  }
  return rows;
}

const appSources = sourceFiles("src/**/*.{ts,tsx}").filter(
  (file) =>
    !file.startsWith("src/__tests__/") &&
    !file.startsWith("src/generated/") &&
    !/\.test\.tsx?$/.test(file),
);

const dataSources = appSources
  .filter((file) => file.startsWith("src/data/"))
  .map((file) => readSource(file));

const isLive = ({ read }: RegistryRow) =>
  dataSources.some((source) =>
    new RegExp(`export (async function|const) ${read}\\b`).test(source),
  );

const registry = registryRows();

describe("cache pairing (no live registry row in Stage A)", () => {
  test("scans the app's source files", () => {
    expect(appSources).toContain("src/proxy.ts");
    expect(dataSources.length).toBeGreaterThan(0);
  });

  test("the registry parses", () => {
    expect(registry.map(({ read }) => read)).toContain("getCategories");
    expect(registry.every((row) => row.tags.length > 0)).toBe(true);
  });

  test("no registry row is live yet (spec 08 adds getCategories)", () => {
    expect(registry.filter(isLive)).toEqual([]);
  });

  test("no cache directive, tag or revalidation outside the registry", () => {
    const hits = appSources.flatMap((file) => {
      const source = readSource(file);
      return CACHE_APIS.filter((api) => source.includes(api)).map(
        (api) => `${file}: ${api}`,
      );
    });
    expect(hits).toEqual([]);
  });

  test("no one-argument revalidateTag anywhere", () => {
    const oneArgument = /revalidateTag\(\s*[^,()]+\)/;
    const hits = appSources.filter((file) =>
      oneArgument.test(readSource(file)),
    );
    expect(hits).toEqual([]);
  });
});
