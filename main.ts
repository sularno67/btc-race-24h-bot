// btc-race-24h-bot: a slow-trend follower for CBBTC/USDC, one-minute bars.
//
// Idea: cbBTC on this pool grinds in multi-hour trends with a lot of
// one-minute noise. A fast crossover churns itself to death paying the
// ~46 bps round trip (4 bps fee + 2 bps slippage + ~17 bps impact at the
// dev window's depth, each way), so this bot only rides the slow trend:
// it is long while the close sits above its 30-bar exponential moving
// average with 30-bar momentum not clearly negative, and flat otherwise.
// One position, full size, a handful of trades per day.
//
//   - Entry (flat): close > EMA(30) of closes AND 30-bar return > -20 bps
//     AND the 30-bar high-low range is at least 40 bps of the close
//     (chop filter: a range that narrow cannot plausibly cover the
//     ~26-46 bps round-trip cost, so the bot stays flat in chop).
//     The loose momentum bound just keeps the bot from buying into a
//     sharp leg down; the EMA is the real trend filter.
//   - Exit (long): close < EMA(30) * (1 - 50 bps) — a small buffer under
//     the average so a single noisy bar does not shake it out — OR the
//     position is worth under 99% of its cost (hard stop-loss, tightened
//     from 98% so a sideways drift exits earlier instead of grinding).
//   - Orders fill at the next bar's open, so every signal is judged on
//     the close just received and the fill happens one bar later.
//   - max_slippage_bps is 100 (1%): a fill that far past the close is
//     refused and the signal is simply re-checked on the next bar.
//
// Everything is deterministic: float64 EMA/momentum math on the closes
// alone, no clock, no environment, no randomness. Warm-up batches feed
// the indicators but never trade. A missing bar for the symbol just
// means no indicator step that minute.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const EMA_SPAN = 30;
const MOM_BARS = 30;
/** Entry needs the 30-bar return above this, in bps (may be slightly negative). */
const MOM_MIN_BPS = -20;
/** Exit when the close falls this far under the EMA, in bps. */
const EXIT_UNDER_EMA_BPS = 50;
/** Hard stop: exit when the position is worth under this share of its cost (x/100). */
const STOP_NUM = 99;
const STOP_DEN = 100;
/** Chop filter: the 30-bar high-low range must be at least this, in bps of the close. */
const CHOP_BARS = 30;
const CHOP_MIN_BPS = 40;
/** Slippage cap on every order, in bps. */
const MAX_SLIPPAGE_BPS = 100;

/** The highs and lows seen so far, newest last, as plain numbers (raw price units). */
const highs: number[] = [];
const lows: number[] = [];

/** High-low range over the last CHOP_BARS bars, in bps of the latest close; null before enough bars. */
function rangeBps(close: number): number | null {
  if (highs.length < CHOP_BARS || close === 0) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = highs.length - CHOP_BARS; i < highs.length; i++) {
    if (highs[i]! > hi) hi = highs[i]!;
    if (lows[i]! < lo) lo = lows[i]!;
  }
  return ((hi - lo) / close) * 10_000;
}

/** The closes seen so far, newest last, as plain numbers (raw price units). */
const closes: number[] = [];
/** EMA(30) of closes, null until the first 30 closes have seeded it. */
let ema: number | null = null;

function stepEma(close: number): void {
  if (ema !== null) {
    ema += (2 / (EMA_SPAN + 1)) * (close - ema);
    return;
  }
  closes.push(close);
  if (closes.length === EMA_SPAN) {
    ema = closes.reduce((a, x) => a + x, 0) / EMA_SPAN;
  }
}

/** Full close history for the momentum lookback (cheap: 1440 bars). */
const history: number[] = [];

function momentum(close: number): number | null {
  if (history.length <= MOM_BARS) return null;
  const back = history[history.length - 1 - MOM_BARS];
  if (back === 0) return null;
  return ((close - back) / back) * 10_000;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const c = Number(bar.c);
      history.push(c);
      highs.push(Number(bar.h));
      lows.push(Number(bar.l));
      stepEma(c);
    }
    if (state.warmingUp || ema === null) return [];

    const close = state.close(SYMBOL);
    if (close === null) return [];
    const closeNum = Number(close);
    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const underEma = closeNum < ema * (1 - EXIT_UNDER_EMA_BPS / 10_000);
      const stoppedOut = value * BigInt(STOP_DEN) < held.cost * BigInt(STOP_NUM);
      if (underEma || stoppedOut) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }

    const mom = momentum(closeNum);
    if (mom === null) return [];
    const range = rangeBps(closeNum);
    if (range === null || range < CHOP_MIN_BPS) return [];
    if (closeNum > ema && mom > MOM_MIN_BPS) {
      const room = state.weightRoom(SYMBOL);
      let slice = state.cash < room ? state.cash : room;
      if (slice <= 0n || slice < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
    }
    return orders;
  },
});
