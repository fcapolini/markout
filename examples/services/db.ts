/**
 * A pretend database, so the example has something to be a service TO.
 *
 * In-memory and fake on purpose -- what is being shown is the seam, not the
 * storage. Every call is async and slightly slow, because that is the part
 * that matters: the page waits for these while it renders, and the visitor
 * never does.
 */

const FLEET = [
  { id: 'aurora', name: 'Aurora', region: 'eu-west', status: 'healthy', load: 0.42 },
  { id: 'borealis', name: 'Borealis', region: 'us-east', status: 'degraded', load: 0.88 },
  { id: 'cygnus', name: 'Cygnus', region: 'ap-south', status: 'healthy', load: 0.31 },
  { id: 'draco', name: 'Draco', region: 'eu-west', status: 'down', load: 0 },
];

const INCIDENTS: { [nodeId: string]: { at: string; summary: string }[] } = {
  borealis: [
    { at: '2026-08-16T09:12:00Z', summary: 'Latency above threshold' },
    { at: '2026-08-16T09:40:00Z', summary: 'Shed 12% of traffic' },
  ],
  draco: [{ at: '2026-08-16T07:03:00Z', summary: 'Host unreachable' }],
};

/** stands in for a network round trip, so the render has something to wait on */
function slow<T>(value: T, ms = 25): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

export function openDatabase() {
  return {
    fleet: {
      all: () => slow(FLEET.map(n => ({ ...n }))),
      /** the busiest node, which the page then asks for incidents about --
       *  one result feeding the next request, settled in two rounds */
      busiest: async () => {
        const nodes = await slow(FLEET);
        return nodes.reduce((a, b) => (b.load > a.load ? b : a));
      },
    },
    incidents: {
      forNode: (id: string) => slow(INCIDENTS[id] ?? []),
    },
  };
}

export type Db = ReturnType<typeof openDatabase>;
