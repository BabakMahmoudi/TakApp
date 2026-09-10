# TAK — The Community Coffee Token

*TAK is a digital coffee coupon; through collective purchasing power, it makes good coffee cheaper for everyone.*

**A decentralized coffee cooperative on the Stellar network**

*Version 1.0 — September 2026*

---

## Abstract

TAK is a token born in a small café in Farahan, Iran, out of a simple observation: a group of friends discovered that the wholesale price of coffee is dramatically lower than the price any single café — or any single person — pays for it. If they pooled their money and bought coffee together, everyone could drink better coffee for far less.

TAK turns that idea into a working system. It is a SEP-41 token on the Stellar network that acts as a **digital coupon and membership share** in a community-owned coffee supply chain. Members buy TAK, coffee shops accept TAK, and the community uses the pooled value to buy and import coffee in bulk — passing the savings back to its members as a real, per-cup discount.

The project ships as a non-custodial Progressive Web App wallet, a read-only Telegram assistant, and an in-app AI agent — all built on open, battle-tested infrastructure. TAK is not a token with an abstract promise: it is backed by a concrete flow of coffee, a real community, and a business model that works because coffee is a product people already buy every day.

This whitepaper explains the origin of TAK, the economics that make it work, the token, the technology, and the roadmap. Our goal is simple and honest: **to make a cup of good coffee cheaper for everyone who joins.**

---

## 1. Introduction

### 1.1 How it started

One day, in a small café in Farahan — a town in central Iran — a few friends were talking over espresso. Someone mentioned the wholesale price of coffee quoted by an online importer. The group did the math: if we could buy **one ton of coffee at that price**, we could drink coffee at a reasonable cost for the rest of the year — especially in a country with high inflation, where prices rise almost every day.

The suggestion that followed changed everything:

> *"Let's pool our money and buy coffee together. We'll give it to Alireza, the café owner, so he can serve it at a discount to everyone who contributed."*

To keep it fair, each person would receive **coupons proportional to what they contributed**. Then someone said the obvious thing: the cleanest, most transparent way to create and track these coupons is a **blockchain**.

Stellar was chosen because it is fast, cheap, energy-efficient, and designed for exactly this kind of real-world payment. The token was named **TAK** — the word customers use to order one coffee (*TAK* = "one").

### 1.2 Why this matters

What started as a favor among friends revealed a much bigger opportunity. Coffee is a global commodity, yet its final price is inflated by a long chain of intermediaries — importers, distributors, wholesalers, and retailers — each adding a margin. An individual café or an individual drinker has no bargaining power against that chain. But a **community** does.

If enough people pool their purchasing power, they can:

1. Buy (and eventually import) coffee at or near wholesale prices.
2. Negotiate better terms through guaranteed, prepaid demand.
3. Distribute coffee locally at a fraction of the retail markup.
4. Give every member a transparent, fair, proportional share — enforced by code, not by trust.

TAK is the accounting layer that makes this possible.

### 1.3 The vision

We began with a single café. We now believe the same idea can grow to a region, then a country — a national, community-owned coffee network where **any TAK holder can enjoy cheap, quality coffee in any participating coffee shop.**

---

## 2. The Problem

### 2.1 Small buyers pay the highest price

Coffee is sold in many layers, and price rises steeply as volume falls:

| Stage | Typical price | Who pays it |
| --- | --- | --- |
| Green coffee (Arabica futures) | ~\$6.4 / kg (~\$2.9 / lb) | Roasters, large importers |
| Roasted coffee, bulk / import | ~\$7–8 / kg | Large-scale buyers |
| Roasted coffee, local café purchase | ~\$9–14 / kg (2–3 million Toman) | Independent cafés |

Local cafés in our launch region currently buy roasted coffee at **2 to 3 million Toman per kilogram (≈ \$9–14/kg)** — a figure reported directly by the shop owners themselves. That is roughly **30–50% above the bulk price** the community can reach by pooling purchases. The people who drink the coffee (and the small shops who serve it) are the ones paying the highest prices, because they buy in the smallest quantities.

### 2.2 Inflation punishes small, frequent purchases

In economies with high inflation, coffee prices rise continuously. The purchasing power of a local café — and of a customer's daily budget — erodes month by month. Buying in bulk, at today's lower prices, is a rational hedge: it locks in a lower cost for an entire period and shields the community from future price spikes.

### 2.3 Pooled buying is hard without trust and accounting

Buying collectively sounds simple, but it breaks down in practice:

- Who keeps track of who contributed how much?
- Who decides the discount each member deserves?
- How do we prevent double-spending a coupon?
- How does a café in another city verify a coupon it has never seen?

Traditional solutions require a trusted middleman, paper coupons, or manual ledgers — all error-prone and expensive. A blockchain token solves these problems with open, tamper-proof accounting.

---

## 3. The Solution

TAK is a **community coffee cooperative** implemented as a token on Stellar.

### 3.1 What TAK is

- **A payment token.** Coffee shops accept TAK as payment for coffee.
- **A digital coupon.** Holding TAK entitles the holder to the community's discounted coffee.
- **A fair share.** The ledger records exactly how much each member contributed and is entitled to — no disputes, no lost coupons.
- **A unit of account for coffee.** One TAK is anchored to **20 g of roasted coffee — one cup's worth** (the word "TAK" means "single", as in "one coffee").

### 3.2 How the loop works

```
          members pool money
                 │
                 ▼
      community buys/imports coffee
      in bulk at wholesale price
                 │
                 ▼
      coffee is stored centrally
                 │
                 ▼
  coffee shops accept TAK ────────► send TAK back to the store
        │                                    │
        │ serve discounted coffee            │ receive dry coffee
        ▼                                    ▼
   members pay TAK                  beans replenished
```

1. Members buy TAK, pooling real value into the community.
2. The community uses that pooled value to buy (and later import) coffee in tonnage at wholesale prices.
3. Coffee is stored centrally; participating shops draw from it.
4. A shop serves coffee to members at a discount, in exchange for TAK.
5. The shop returns the TAK to the store to receive more dry coffee, keeping the cycle in balance.

Because every step is recorded on a public ledger, fairness is guaranteed by mathematics, not by goodwill.

### 3.3 Why Stellar

Stellar is purpose-built for this use case:

- **Fast and cheap** — payments settle in seconds for fractions of a cent.
- **Energy-efficient** — Stellar's consensus model consumes far less energy than proof-of-work chains, which matters for a project built around a physical, everyday product.
- **Built for real assets** — SEP-41 Soroban tokens are the standard for issued assets on Stellar.
- **Non-custodial by design** — members keep their own keys, aligning perfectly with our principle that no one but you controls your coffee money.

---

## 4. The Business Case

> *This is the heart of the whitepaper: the numbers that explain why TAK can make coffee measurably cheaper. Global figures are drawn from public commodity data as of late 2026; local figures (what cafés actually pay for beans and charge for a coffee) come from direct observation of the launch market. For the local currency we use **1 USD = 220,000 Toman** and the unit **KT = 1,000 Toman**, so one coffee priced at 70–100 KT equals roughly **\$0.32–0.45**. All figures are illustrative.*

### 4.1 The commodity reality

Arabica coffee — the benchmark for the world's espresso-quality beans — traded at roughly **\$2.91 per pound (≈ \$6.4 per kg of green coffee)** on ICE futures in September 2026. It reached an all-time high of **\$4.41/lb in February 2025**, and its historical low was about **\$0.42/lb**. But what matters most to us is the local price: cafés in our launch region today buy roasted coffee at **2 to 3 million Toman per kilogram (≈ \$9–14/kg)**. The price swings are large, but the direction of the retail markup is always the same: every intermediary between the farm and your cup adds a margin.

This is the structural inefficiency TAK exploits. The community does not need to become a roaster or a multinational to capture savings — it only needs to **buy at a larger scale than any single café can**, which is precisely what pooling achieves.

### 4.2 How much coffee is in one coffee?

The Italian Espresso National Institute defines a single (*solo*) at **7 ± 0.5 g**, a double (*doppio*) at 14 g, and a triple at 21 g. But the "one coffee" a customer actually orders and pays for in most cafés — the base of cappuccino and latte — is a **double**, dosed at **18–20 g** in modern specialty practice. That is the unit TAK is anchored to:

> **1 kg of roasted coffee ≈ 143 single shots ≈ 50 "one coffees" (at 20 g).**

So **1 TAK = 20 g = the coffee in one cup**, not the tiny 7 g technical single.

### 4.3 The per-cup math

Using reference prices:

| Purchase channel | Roasted coffee cost | Cost per one coffee (20 g) |
| --- | --- | --- |
| Local café (status quo) | ~\$9–14 / kg (2–3M Toman) | **~40–60 KT (~\$0.18–0.27)** |
| Community bulk purchase | ~\$7–9 / kg | **~30–40 KT (~\$0.14–0.18)** |
| Community direct import | ~\$5.5–7 / kg | **~24–30 KT (~\$0.11–0.14)** |

The community's pooled purchase cuts the bean cost of one coffee by roughly **30%** — and direct import pushes it lower still.

### 4.4 Why the savings reach the whole cup

A cup of espresso is sold for far more than its beans are worth, because a café must cover rent, staff, equipment, and milk. In expensive Western cafés beans are only about **10–15%** of the cup price; but in our launch market one coffee sells for **70 to 100 KT (≈ \$0.32–0.45)** while the beans in that cup — at the 2–3 million Toman/kg cafés pay — cost **40 to 60 KT**, i.e. roughly **half** of the cup. So the naïve critic's question — *"how much can a discount on beans really matter?"* — has a clear answer: in a low-cost local market, beans are a far larger share of the cup, so a bean discount matters that much more.

The answer has three parts:

1. **The café keeps its margin.** The discount to members comes from the bean input, not from the café's overhead. The café earns the same (or better) margin per cup because the community supplies the beans cheaply and guarantees volume.

2. **Prepaid, guaranteed demand.** Members pre-buy TAK, which is effectively prepaid demand for the café. Predictable revenue is worth more than a fickle walk-in customer, so a café can afford to pass savings through.

3. **The cooperative captures the retail-to-wholesale spread** on the one input it fully controls — the beans. That spread (30–50%) is real, recurring, and directly attributable to the community's scale.

The net effect: bean savings alone return roughly **15 to 24 KT per coffee (about 15–25% of the cup price)** to the member; and when the member café — itself part of the community, profiting from cheaper beans and guaranteed demand — also shares part of its margin, the total discount reaches **20–30%**, in line with the project's original target of "about 30% discount in each cup."

### 4.5 A worked example

Take a café in Farahan that buys roasted coffee at **2,500,000 Toman/kg** (the midpoint of the real 2–3 million range) and sells one coffee at **90 KT** (the midpoint of the real 70–100 KT range):

- Beans per coffee: 20 g × 2,500 Toman = **50 KT** (about 56% of the cup price)
- Non-bean costs + café margin (rent, staff, energy, machine, cup): **~40 KT**

Now join the community and draw beans from the community store:

| Scenario | Beans per coffee | Member price | Discount vs 90 KT |
| --- | --- | --- | --- |
| Café small-lot (status quo) | 50 KT | 90 KT | — |
| Community bulk beans | 35 KT | 75 KT | ~17% |
| Bulk beans + margin sharing | 35 KT | 60–65 KT | ~28–33% |
| Direct import + margin sharing | 26 KT | 55–60 KT | ~33–39% |

In the second scenario the café keeps its margin and passes the bean saving (~15 KT per coffee) straight to the member. In the later scenarios the member café — itself part of the community — also shares part of its margin in exchange for loyal, prepaid demand. The result is exactly what was targeted from the start: **up to about 30% off every cup**, without the café losing money.

*The 70–100 KT coffee price (and the 2–3 million Toman/kg cafés pay for beans) is the real range observed in this region's cafés; the bean figures and discount percentages are illustrative, and exact numbers depend on local bean prices, rents, and exchange rates. The structural conclusion holds everywhere: pooling purchasing power lowers the bean cost, and that saving flows to members without squeezing the café.*

### 4.6 Why coffee shops join

A café owner has clear, selfish reasons to accept TAK:

- **Cheaper beans.** They draw from the community store at wholesale rather than buying retail.
- **Guaranteed demand.** TAK holders are a loyal, prepaid customer base with a reason to return.
- **New foot traffic.** The community directory and map surface the shop to every TAK holder nearby.
- **No special hardware.** Payments use the same Stellar network and the same app; no new POS system is required.
- **Marketing.** "We accept TAK" is a badge of membership in a growing community.

### 4.7 Why it scales to a country

The model is not limited to one café or one town:

- **More members** → larger pooled purchases → better wholesale terms → bigger discounts → more members (a virtuous cycle).
- **Import at scale.** Once the community is large enough, it can import containers of green or roasted coffee directly, capturing the importer's margin too — the vision stated in the original idea: *buy or even import coffee and set up low-cost distribution all over the country.*
- **Standardized distribution.** A central store plus regional cafés is a classic, low-cost distribution network; TAK is the accounting and settlement layer that makes it fair and auditable.
- **Inflation hedge.** In inflationary environments, locking in bulk coffee at today's prices protects members' purchasing power — a tangible, everyday benefit.

---

## 5. The TAK Token

### 5.1 Token facts

| Property | Value |
| --- | --- |
| Blockchain | Stellar |
| Token standard | SEP-41 (Soroban smart contract token) |
| Symbol | TAK |
| Decimals | 7 |
| Contract (testnet) | `CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C` |
| Supply model | Elastic — minted/burned 1:1 against 20 g coffee (see §5.5) |
| Custody | Non-custodial — members hold their own keys |
| Bean anchor | 1 TAK = 20 g of roasted Arabica (medium-dark) |
| Issue price | ≈ 35 KT (the bulk cost of 20 g coffee; tracks the coffee price) |
| Transaction fee | 1% on transfers (governance-adjustable) |

### 5.2 The bean anchor — what backs one TAK

TAK is not an unbacked token. It is anchored to a physical quantity of roasted coffee:

> **1 TAK = 20 grams of roasted Arabica coffee (medium-dark roast).**

The community's coffee reserve issues and redeems TAK against real, stored beans at this fixed rate, so a holder always knows exactly how much coffee a TAK represents. This is the token's **hard floor**.

**Why anchor to beans.** A bean anchor gives TAK three properties a plain coupon lacks:

1. **An intrinsic floor.** Even if market interest fades, 1 TAK still buys 20 g of real coffee.
2. **An inflation hedge.** As bean prices in Toman rise with inflation, so does TAK's value — protecting members' coffee budget.
3. **A stable, intuitive unit.** Café menus priced in TAK (that is, in grams of beans) stay meaningful even when the Toman fluctuates, and shops settle with the store at a predictable 20 g per TAK.

**Why 20 grams.** The dose behind the standard "one coffee" served in most cafés — a modern double espresso and the base of cappuccino and latte — is **18–20 g** of ground coffee. Twenty grams is therefore exactly "one cup's worth of coffee":

| Espresso size | Ground coffee | Beans in TAK (÷ 20 g) |
| --- | --- | --- |
| Single (solo) | 7 g | 0.35 |
| Double (doppio) | 14 g | 0.70 |
| Modern double / "one coffee" | 18–20 g | ≈ 1.0 |
| Triple | 21 g | 1.05 |

It is round, memorable, and maps cleanly onto the founding intuition "one TAK ≈ one coffee."

**Bean grade.** The anchor is defined against **Arabica** — the quality standard for espresso — or an **Arabica-dominant blend (≥70% Arabica)**, medium or medium-dark roast, commercial-specialty grade. Robusta is cheaper and higher in caffeine but bitter and lower-grade; anchoring to it would inflate the gram count while cheapening the promise, so Arabica is the correct reference. The precise grade is fixed by community governance and can be reviewed as the community matures.

**Value at the anchor.** At the community's bulk price (~1,750,000 Toman/kg), 20 g ≈ **35 KT (≈ \$0.16)**. At the price local cafés pay (2–3 million Toman/kg), the same 20 g costs **40–60 KT**. That range is the hard floor of one TAK.

**From beans to a served cup.** A served cup costs more than its beans, because the café adds rent, staff, energy, and margin. Cafés therefore price drinks as *beans + service*:

| Drink | Beans | Beans (TAK) | Indicative menu price (TAK) |
| --- | --- | --- | --- |
| Espresso, single | 7 g | 0.35 | ~1 |
| Espresso, double ("one coffee") | 18–20 g | 0.90–1.0 | ~2–2.5 |
| Cappuccino / latte | 18 g | 0.90 | ~2.5–3 |
| Large / extra shot | 21 g | 1.05 | ~3 |

The "one TAK = one coffee" intuition holds at the bean level (one cup ≈ 20 g ≈ 1 TAK of coffee); the extra 1–2 TAK in the menu price is the café's service, and that is exactly where the community's member discount and the café's margin-sharing operate (§4.5). Because TAK has 7 decimals, the 20 g rate never constrains payment precision, and the rate can be revised by community governance if the standard dose or blend changes.

### 5.3 Token utility

TAK is a **utility token**, not a speculative security. Its functions are concrete:

1. **Payment** — accepted by participating coffee shops for coffee and other menu items.
2. **Discount entitlement** — holding and spending TAK is what qualifies a member for the community price.
3. **Loyalty & rewards** — free-token claims, games, and lotteries distribute TAK to active members.
4. **Settlement** — shops return TAK to the community store to draw more beans, closing the physical-digital loop.
5. **Membership signal** — TAK holdings represent a member's proportional stake in the cooperative.
6. **The KT unit.** For readability, prices and amounts are shown in the wallet in **KT**, where **1 KT = 1,000 Toman**; one coffee is priced at **70 to 100 KT**.

### 5.4 Proposed tokenomics (illustrative)

> *The allocation below is a **proposal** for community discussion and governance. The economic model in §4 does not depend on any particular split; it depends only on the cooperative's pooled purchasing power.*

| Allocation | Share | Purpose |
| --- | --- | --- |
| Coffee reserve | 40% | Community pool used to buy and import coffee |
| Ecosystem & adoption | 20% | Faucet claims, games, lotteries, shop incentives |
| Liquidity | 10% | Exchange liquidity for fair entry/exit |
| Development & grants | 10% | Ongoing development, audits, regional grants |
| Team & contributors | 15% | Vested over time, aligned with long-term growth |
| Early community | 5% | Founding members and early supporters |

All future issuance decisions, including any governance over the coffee reserve, are intended to be made transparently by the community, on-chain where possible.

### 5.5 Minting, burning, and the transaction fee

TAK is issued by **TAK HQ** (the central organization) under a strict full-backing rule: every TAK in circulation is backed by exactly 20 g of roasted coffee held in the community store.

**Minting (issue).** A customer buys TAK from HQ at the **issue price — the current bulk cost of 20 g of coffee, ≈ 35 KT today**. HQ uses that payment to buy 20 g of coffee into the store and mints exactly 1 TAK for the customer. No TAK is ever created without 20 g of coffee behind it.

**Burning (redemption).** A coffee shop sends the TAK it has collected back to HQ. For every 1 TAK received, HQ sends 20 g of coffee to the shop and **destroys** (burns) the token. Supply shrinks in lockstep with the coffee leaving the store, so the reserve always exactly covers the circulating supply.

This mint-and-burn cycle is a simple currency board: TAK supply expands only when coffee is added and contracts only when coffee is withdrawn. The Toman price of TAK therefore tracks the price of coffee — which is exactly why TAK shields members from coffee inflation. It also supersedes any fixed supply cap: the §5.4 allocation is the founding treasury's distribution, not a supply schedule.

**The transaction fee — and what it pays for.** A small fee on each TAK transfer funds the organization that runs the network. The costs are real and mostly human:

| Cost category | Pilot (≈1,000 cups/day) | Regional (≈10,000/day) | National (≈100,000/day) |
| --- | --- | --- | --- |
| Cloud (Workers + D1 + Horizon) | ~0–3M Toman/mo | ~10–30M | ~50–150M |
| Team (dev, ops, support, community) | ~60–90M | ~300–500M | ~800M–1.5B |
| Marketing, audits, legal, logistics | ~5–10M | ~50–100M | ~300–500M |
| **Total** | **~65–100M** | **~360–630M** | **~1.15B–2.15B** |

A naive **0.5%** fee is too low to sustain the organization at the scales where TAK operates today:

- Pilot (~2.7B Toman/month transacted) needs **≈3%** to cover ~85M of costs.
- Regional (~27B Toman/month) needs **≈1.9%** to cover ~500M.
- National (~270B Toman/month) needs **≈0.6%** to cover ~1.65B.

We therefore set the fee at **1%**, adjustable by community governance:

- **1% is cheaper than card networks (1.5–3%)** and comparable to mainstream payment apps, so it stays fair to members and shops.
- At launch, 1% does not fully cover a full-time team; the founding treasury (and the "Team & contributors" allocation) bridges the gap until volume grows.
- As the community reaches national volume, the fee can be lowered toward 0.5%.

All fee revenue is spent transparently on operations (servers, people, audits, support); the rate is a governance parameter, never a hidden charge.

---

## 6. Technology

TAK is built on open infrastructure chosen for reliability, cost, and a hard commitment to self-custody.

### 6.1 The wallet (PWA)

- **Non-custodial.** Secret keys are generated on the device, encrypted with Web Crypto (PBKDF2-SHA256), and stored only in the browser. The server stores public keys only and can never move user funds.
- **Recovery.** A standard BIP-39 12-word mnemonic lets a member restore their account on any device.
- **Offline-first.** Core flows — login, balance view, payment — work offline with sensible caching, and the app is installable as a Progressive Web App.
- **Built with** Next.js 15, React 19, tRPC, and Tailwind CSS, hosted on Cloudflare Workers with Cloudflare D1 (SQLite) and Drizzle ORM.

### 6.2 Authentication & security

- **SEP-10.** Members authenticate by signing a challenge locally with their decrypted key; the server verifies the signature and issues a signed token. Challenges are single-use, time-limited, and tamper-evident.
- **Verification.** Email, SMS, and Google Authenticator (TOTP) verification are supported behind a pluggable provider interface.
- **Bounded server-held keys.** The server holds only two narrowly-scoped keys: one that funds new accounts with XLM, and one that signs the community's own TAK rewards (games, the one-time 3-TAK claim faucet, and withdrawals). Neither can sign a user's transactions or touch a user's balance.
- **Keys never leave the device.** Encryption keys, recovery phrases, and Stellar secret keys are never sent to or stored on the server in plaintext.

### 6.3 AI assistants (read-only)

- **Telegram bot.** Members can ask natural-language questions — *"show my balance"*, *"where can I pay?"* — and get answers. The bot parses free-form text into a restricted, validated read-only command set (balance, shops, history). It has no signing path and can never move funds.
- **In-app AI agent.** A conversational assistant inside the app (Cloudflare Agents SDK, Durable Objects) answers questions about TAK and coffee, with read-only tools for balance and history.
- **Safety.** Large-language-model output is treated as untrusted input and mapped to a fixed allow-list of commands; prompts and responses never contain secret keys or signed transactions.

---

## 7. Ecosystem & Products

1. **TAK Wallet (PWA)** — sign up, hold XLM and TAK, pay for coffee, browse shops, order ahead, and track history, all offline-capable.
2. **Coffee ordering** — browse a shop's TAK-priced menu, build an order, pay in a single transaction, and get notified (Web Push) when it's ready.
3. **Get TAK** — a one-time free claim (3 TAK) so every new member can try the system immediately.
4. **Games & lottery** — coffee-themed games (Espresso Roulette, Brewing Speed Challenge, Barista Puzzle) and a weekly community lottery, designed to make the wallet fun and to onboard new members.
5. **Telegram assistant** — read-only balance, shop, and history queries in natural language.
6. **In-app AI agent** — a knowledgeable coffee-and-TAK assistant inside the app.

---

## 8. Roadmap

| Phase | Focus |
| --- | --- |
| **Phase 1 — Pilot (Farahan)** | Working wallet, TAK token on Stellar testnet, a few pilot shops, community onboarding, games and free-claim faucet. |
| **Phase 2 — Region** | Onboard more cafés in the region, first real pooled purchases, member discounts live, Telegram assistant and in-app agent mature. |
| **Phase 3 — Import & scale** | Bulk import of coffee, central storage and distribution, expand to new cities, on-chain governance over the coffee reserve. |
| **Phase 4 — National network** | A country-wide network of participating shops; any TAK holder enjoys cheap, quality coffee anywhere in the network. |

---

## 9. Community & Governance

TAK is first and foremost a community. The founding principles:

- **Fairness.** Every member's share is proportional to their contribution, recorded on a public ledger.
- **Self-custody.** No one holds your keys or your coffee money but you.
- **Transparency.** All pooled purchases and distributions are auditable.
- **Gradual decentralization.** Decision-making over the coffee reserve, pricing, and expansion is intended to move progressively to the community, on-chain where feasible.

---

## 10. Risk Factors

Investing in or using TAK involves risks that every participant should understand:

- **Market risk.** The value of TAK may fluctuate. TAK is a utility token for buying coffee, not an investment product.
- **Commodity risk.** Coffee prices can rise sharply; the cooperative hedges by buying in bulk, but cannot eliminate price risk.
- **Regulatory risk.** Cryptocurrency and digital-token regulation varies by jurisdiction and may change.
- **Technology risk.** Software, smart contracts, and the Stellar network may contain bugs or be subject to outages.
- **Adoption risk.** The discount model depends on enough members and shops participating.
- **Execution risk.** Importing and distributing physical coffee involves logistics, quality control, and counterparties.

Nothing in this document constitutes financial, investment, or legal advice.

---

## 11. Conclusion

TAK began as a conversation in a small café about the price of coffee — and became a system for making coffee cheaper through cooperation. It combines a real economic insight (bulk purchasing power), a fair and transparent mechanism (a Stellar token), and a product people already use every day (coffee).

The promise is simple: **pool together, buy together, and everyone drinks better coffee for less.**

Join us, and let's build a community where the price of one coffee — *a TAK* — is fair for everyone.
