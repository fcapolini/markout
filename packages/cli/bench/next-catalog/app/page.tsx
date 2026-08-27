import Catalog from './Catalog';

// Reading searchParams makes this route dynamic, which is the point: this port
// exists to be the peer of Markout's SERVED mode, so the render has to happen
// per request. A statically prerendered variant would be the peer of `markout
// prerender`, which the benchmark deliberately does not measure -- a catalog's
// rows are the kind of thing that changes without a redeploy.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ rows?: string }>;
}) {
  const { rows } = await searchParams;
  const n = Number(rows);
  // Same rule as every other port: ?rows=N picks the catalog size, divided by
  // 30 for the model count, defaulting to the 300-row demo shape.
  const modelCount = n > 0 ? Math.round(n / 30) : 10;
  return <Catalog modelCount={modelCount} />;
}
