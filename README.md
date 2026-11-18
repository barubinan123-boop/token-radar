# Token Radar

[![make.fun](https://img.shields.io/badge/make.fun-token--radar--01-blue)](https://make.fun/bounty/token-radar-01)
[![reward](https://img.shields.io/badge/reward-%241%2C325-green)](https://make.fun/bounty/token-radar-01)

A token launch radar: it ranks pre-token DeFi protocols by implied launch
value and shows how to farm each one. Built for the make.fun bounty
[token-radar-01](https://make.fun/bounty/token-radar-01).

## How it works

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama
snapshot at `/input/snapshot.json`, scores every pre-token protocol with the
model in `lib/model.ts`, and writes `board.json`, the dashboard data and
`dossier.json` to `/output`.

The model (`radar-2`) is one function of the snapshot's own figures, no
protocol name is special-cased:

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + min(chains - 1, 4) x 0.03) )
```

- **TVL** is the base: a bigger protocol would launch a bigger token.
- **Seven-day growth** rewards momentum and punishes decline.
- **Age with no token** rewards protocols that have run longest without one.
- **Chain count** rewards protocols live on more chains, capped at +12%.

The board covers all 40 watchlist protocols (TVL >= $50M, no token on
record) and adds 240 pre-token protocols below that floor, by TVL — 280 rows
in total. Live-token protocols are set aside with their market caps shown,
never mixed into the ranking.

Every row carries a 7-step farm plan derived from its own record — category,
chains, TVL and age — with a cost and a time for each step, including a
weekly repeat of the protocol's core action on a second chain when it has one.

## The dashboard

`dashboard/` is a static page with no network: search, filter by category,
sort by rank / name / TVL / growth / age, a detail view per protocol with
the model's inputs and the farm plan, and a live-token view kept apart.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## License

MIT — see `LICENSE`.
