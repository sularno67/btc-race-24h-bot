# btc-race-24h-bot
[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/sularno67/btc-race-24h-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/sularno67/btc-race-24h-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A BTC trading bot for the make.fun competition
[btc-race-24h-20261123-0511](https://make.fun/bounty/btc-race-24h-20261123-0511):
it trades Coinbase Wrapped BTC (cbBTC) against USDC, one minute at a time,
in a replay of on-chain Orca Whirlpool prices. Paper money only — 1,000 USDC
start, long only, no leverage. It speaks the `agent-fun/bars-replay/v1`
protocol (newline-delimited JSON on stdin/stdout) via the kit's SDK shim in
`vendor/`.

## Strategy: slow-trend follower

cbBTC on this pool grinds in multi-hour trends under a lot of one-minute
noise, and a full-size round trip costs roughly 46 bps (4 bps fee + 2 bps
slippage + ~17 bps price impact each way at the dev window's depth), so
fast crossovers churn themselves to death. This bot only rides the slow
trend:

- **Enter** (flat): the close is above its 30-bar EMA **and** the 30-bar
  return is above −20 bps. The loose momentum bound just keeps it from
  buying into a sharp leg down; the EMA is the real trend filter.
- **Exit** (long): the close falls 50 bps under the 30-bar EMA, or the
  position is worth under 98% of its cost (hard stop-loss).
- One position, full size, a handful of trades per day. Every order caps
  slippage at 100 bps; a fill past that is refused and the signal is
  re-checked on the next bar.

Everything is deterministic: float64 EMA/momentum math on the closes
alone — no clock, no environment, no randomness. Warm-up batches feed the
indicators but never trade.

## Dev-window result (local grade)

```
net PnL   +23.149224 USDC
trades    5, max drawdown 2.79%, 0 rejected
determinism: two runs reproduced byte for byte
```

Grade it yourself:

```
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

## Layout

- `main.ts` — the bot (entrypoint, run with `node /bot/main.ts`)
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's SDK shim
- `.makefun/owner.json` — claim file naming the entrant's wallet
