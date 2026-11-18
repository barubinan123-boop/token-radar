// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult  = 1 + min(chains - 1, 4) x CHAIN_WEIGHT
//                (a protocol live on more chains reaches more farmers and more
//                liquidity, so its launch is worth more; capped so one extra
//                chain can never dominate the TVL term)
//   focusMult  = 1 + FOCUS_WEIGHT x (1 - min(chains, 5) / 5)
//                (the same TVL spread over fewer chains is deeper liquidity per
//                chain, so a focused protocol launches stronger; a protocol on
//                five or more chains gets no focus bonus at all)
//   implied    = max(1, round(base x growthMult x maturityMult x chainMult x focusMult))
//
// The constants are the radar-2 model's, stated in the dashboard and changeable in the model sandbox.
// No protocol name is ever special-cased: the same function scores every row.
//
// The constants are the house model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document: one date, one source, one floor, the protocols, the watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
  focus_weight: number;
  focus_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.03,
  chain_cap: 4,
  focus_weight: 0.05,
  focus_chains: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 240;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model that scored it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    focus_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  focus_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`: the snapshot's nulls become a neutral value here. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; focusMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const chainMult = 1 + extraChains * model.chain_weight;
  const spread = Math.min(Math.max(protocol.chains.length, 1), model.focus_chains);
  const focusMult = 1 + model.focus_weight * (1 - spread / model.focus_chains);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * focusMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, focusMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  return !VERSIONED.test(p.name);
}

/** The snapshot's protocols by slug, for the watchlist lookup. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is in, whether or not the snapshot
  // still carries it (it always does, but the board's coverage is the gate's row and is
  // never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, strongest TVL first,
  // capped at EARLY_ROWS. A chosen protocol stays chosen; the early rows only add.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Score every chosen protocol, strongest implied value first, ties broken by slug so
  // the order is the same on every run.
  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, chainMult, focusMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, focusMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      focus_multiplier: round4(s.focusMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (joined.length > 600) return `${joined.slice(0, 596)}...`;
  if (joined.length < 20) return `${joined} Hold the position and check the protocol's own page.`;
  return joined;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  const tiers: Array<[number, number]> = [
    [5_000_000_000, 250],
    [1_000_000_000, 150],
    [100_000_000, 100],
  ];
  for (const [floor, capital] of tiers) if (p.tvl_usd >= floor) return capital;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  const tiers: Array<[number, number]> = [
    [365, 30],
    [180, 45],
  ];
  for (const [floor, days] of tiers) if (age >= floor) return days;
  return 60;
}

/**
 * The category's core action, as a table: each row names the category words it matches and the
 * sentence the farmer follows, with {capital}, {name} and {chain} filled in. The first matching
 * row wins; a category no row names falls through to the generic deposit at the end.
 */
const ACTIONS: Array<{ words: string[]; text: string }> = [
  { words: ['lend', 'cdp', 'collateral'], text: 'Supply ${capital} of USDC to ${name} on ${chain} and keep the position open.' },
  { words: ['dex', 'yield', 'leveraged farm'], text: 'Provide ${capital} of liquidity to ${name}\u2019s main pool on ${chain} and keep the position open.' },
  { words: ['bridge'], text: 'Bridge ${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.' },
  { words: ['staking', 'restak'], text: 'Stake ${capital} of the chain\u2019s staking asset through ${name} and keep the receipt.' },
  { words: ['perpetual', 'derivative'], text: 'Deposit ${capital} of USDC as margin on ${name} and open one small hedge.' },
  { words: ['prediction'], text: 'Fund ${capital} and place one market position on ${name}.' },
  { words: ['curator', 'allocator'], text: 'Deposit ${capital} into a ${name} vault on ${chain} and keep the shares.' },
  { words: ['stable'], text: 'Mint or deposit ${capital} of the stable asset through ${name} on ${chain}.' },
  { words: ['rwa'], text: 'Mint ${capital} of the protocol\u2019s yield asset on ${chain} and hold it.' },
  { words: ['insurance'], text: 'Buy ${capital} of cover from ${name} on ${chain} and keep the policy.' },
];

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const fill = (t: string): string => t.replaceAll('${capital}', `$${capital}`).replaceAll('${name}', p.name).replaceAll('${chain}', chain);
  for (const row of ACTIONS) {
    if (row.words.some((w) => c.includes(w))) return fill(row.text);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** The weekly repeat of the protocol's core action, as a table keyed on the same category words. */
const WEEKLY: Array<{ words: string[]; verb: string }> = [
  { words: ['lend', 'cdp'], verb: 'adjust the supply position and borrow a small amount against it' },
  { words: ['dex', 'yield'], verb: 'swap a small amount through the pool and re-add the liquidity' },
  { words: ['bridge'], verb: 'bridge a small amount back and forth and use it in the app' },
  { words: ['staking', 'restak'], verb: 'claim the staking rewards and restake them' },
  { words: ['perpetual', 'derivative'], verb: 'close and reopen one small hedge' },
];

function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const c = (p.category ?? '').toLowerCase();
  const hit = WEEKLY.find((row) => row.words.some((w) => c.includes(w)));
  const verb = hit === undefined ? 'make one deposit, swap or vote in the app' : hit.verb;
  return second === null
    ? `Each week on ${chain}, ${verb} so the wallet shows fresh activity.`
    : `Each week, ${verb} on ${chain}, then repeat the same action once on ${second} so both chains show activity.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Read ${p.name}'s own docs and points page first, and note which actions earn points before you spend anything.`,
      cost: 'no fee to read',
      time: '15 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a month, compare ${p.name}'s TVL and 7-day growth with the board's numbers and top the position up only if both are still rising.`,
      cost: 'no fee to check',
      time: '10 minutes a month',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS);
  return live.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days, implied_value_usd } = row;
  return {
    rank,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    age_days,
    implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    focus_multiplier: row.model.focus_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  // The document-level fields, each checked in turn: a missing or mistyped one names itself.
  const docChecks: Array<[boolean, string]> = [
    [typeof o.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.as_of as string), 'snapshot.json has no as_of date'],
    [typeof o.source === 'string', 'snapshot.json has no source'],
    [typeof o.floor_usd === 'number' && Number.isSafeInteger(o.floor_usd) && (o.floor_usd as number) > 0, 'snapshot.json has no floor_usd'],
    [Array.isArray(o.protocols), 'snapshot.json has no protocols array'],
    [Array.isArray(o.watchlist) && (o.watchlist as unknown[]).every((s) => typeof s === 'string'), 'snapshot.json has no watchlist of slugs'],
  ];
  for (const [ok, message] of docChecks) if (!ok) throw new SnapshotError(message);
  const protocols = (o.protocols as unknown[]).map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    // One field, one rule: strings pass through, numbers must be finite, anything else is null.
    const textField = (k: string): string | null => (typeof p[k] === 'string' ? (p[k] as string) : null);
    const numField = (k: string): number | null => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : null);
    return {
      slug: p.slug as string,
      name: p.name as string,
      category: textField('category'),
      chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: numField('change_7d'),
      mcap_usd: numField('mcap_usd'),
      listed_at: textField('listed_at'),
      gecko_id: textField('gecko_id'),
      symbol: textField('symbol'),
    };
  });
  return {
    as_of: o.as_of as string,
    source: o.source as string,
    floor_usd: o.floor_usd as number,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  // Ranks must be exactly 1..N with nothing skipped and nothing repeated.
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  // The board is sorted by value: no row may outrank the one above it.
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  // Every row needs a whole implied value and a farm plan inside the gate's shape.
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** The headline figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The board's headline figures, from the snapshot and the board it scored. */
export function boardSummary(board: BoardRow[], snapshot: Snapshot): BoardSummary {
  return {
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: LIVE_ROWS,
  };
}
