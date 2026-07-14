# E2E order evaluation — 2026-07-14

## Scope

Seven orders were submitted through the real local chat UI at `http://localhost:3000` using the authenticated Mộc Trà test account. Each order was created in a separate chat and allowed to finish before the result was inspected.

The active sandbox snapshot reported by the resolver was:

- Source: `files/bill/BILL.md`
- Snapshot: `snap_8MDw87mEjJyEGw5v47CvHMTdt9Bp`
- Parsed rows: `8,097`

The local message limit was temporarily raised to `1,000,000` by the user so the run was not blocked by HTTP 429.

## Executive result

| Result | Count | Cases |
|---|---:|---|
| Full pass | 1 | Anh Bình Lăng Cô #1 |
| Partial / incorrect resolution | 4 | 43 House CF, 18Grams Cafe, 111 Nguyễn Huệ #1, 111 Nguyễn Huệ #2 |
| Technical failure | 1 | Anh Bình Lăng Cô #2 |
| Correctly blocked for customer confirmation | 1 | Doris Coffee & Tea House |

Only **1/7 orders produced a complete, immediately confirmable order**. No duplicate user request or duplicate assistant response was observed in these seven single-click submissions.

## Case results

### 1. 43 House CF — fail

Chat: `http://localhost:3000/chat/260082a1-c2e9-41a8-8738-70b2b326fc63`

- Customer correctly resolved to `43 House CF (Ancuu_726)`.
- Resolved: cacao and 10 kg white sugar.
- Not found: `bột frap`, `bì thạch trân châu trắng`, `sr dừa`.
- UI result: 2/5 lines resolved; total `377,000đ`, excluding three pending lines.

All three missing products exist in this customer's real history:

- `Bột Frappe Fr33 Luave 1Kg` — `files/bill/BILL.md:4160`
- `Trân Châu 3Q Talinh Trắng` — `files/bill/BILL.md:4939`
- `Syrup Golden Farm Dừa 520ml` — `files/bill/BILL.md:4938`

Evaluation: abbreviation and alias normalization is insufficient. The resolver should support `frap` → `frappe`, `sr` → `syrup`, and common packaging words such as `bì` without losing the product tokens.

### 2. 18Grams Cafe — partial fail

Chat: `http://localhost:3000/chat/c182e4f2-2ce8-472c-81f4-6f82b916252f`

- Customer correctly resolved to `18Grams Cafe (FB_8074)`.
- Correctly resolved Western milk, condensed milk and IMO matcha.
- Failed to resolve `mứt cam nha đam osteberg`.
- UI result: 3/4 lines resolved; total `469,000đ`, excluding one pending line.

The missing product exists in recent customer history as `Sinh Tố Bốn Mùa Osterberg Nha Đam & Cam`, price `123,000đ` at `files/bill/BILL.md:3939`.

Evaluation: the product matcher does not bridge the common business synonym `mứt` → `sinh tố`, the spelling `osteberg` → `osterberg`, or reversed token order `cam nha đam` → `nha đam & cam`.

### 3. 111 Nguyễn Huệ #1 — partial fail

Chat: `http://localhost:3000/chat/e4838e16-eaef-4153-9b94-ad786d436f7f`

- Customer correctly resolved to `111 Nguyễn Huệ (FB_2480)`.
- Correctly resolved condensed milk, yogurt, four Rich's boxes and one Base box.
- Failed to resolve `ly cao + nắp`, `ly thấp + nắp`, and `cafe chữ s`.
- UI result: four resolved lines and three pending lines; total `1,129,000đ` excluding pending lines.

Customer history contains:

- `Ly Nhựa Đế Bằng 500Ml - Hunufa` — `files/bill/BILL.md:4135`
- `Ly Nhựa Đế Bằng 360Ml - Hunufa` — `files/bill/BILL.md:4136`
- `Nắp Cầu PET 93cc Hunufa` — `files/bill/BILL.md:4134`
- `Cà Phê S (Chinh Phục) - Trung Nguyên` — `files/bill/BILL.md:4129`

Evaluation: `ly cao + nắp` and `ly thấp + nắp` are bundle phrases and should either be deterministically expanded into cup plus lid lines or produce a structured candidate confirmation. `cafe chữ s` needs a customer-scoped alias to the product already present in history.

### 4. 111 Nguyễn Huệ #2 — state inconsistency

Chat: `http://localhost:3000/chat/e652e737-9d66-4152-af1e-82191b06575c`

- Customer correctly resolved.
- Resolver reported `6/6 line(s) resolved; 0 pending` and calculated `2,065,000đ`.
- `present_order` independently changed the six `lốc` of unsweetened milk into a pending unit mismatch and reduced the displayed total to `1,849,000đ`.
- The final UI therefore disabled order confirmation despite the resolver claiming a fully resolved draft.

Root cause: unit validation is being performed twice with different rules. The resolver accepted a customer history quantity pattern and resolved the line as six boxes, while `present_order` rejected `lốc` versus `Hộp` and rewrote the authoritative draft.

Evaluation: the resolver output must be authoritative. `present_order` should render the stored draft, not re-resolve or invalidate a line already marked resolved.

### 5. Anh Bình Lăng Cô #1 — full pass

Chat: `http://localhost:3000/chat/3fc7e226-fe0e-4e66-ad0b-b0b1948dc79a`

- Customer resolved to `Anh Bình Lăng Cô (VAT_KH-lc-36)`.
- All 3/3 lines resolved correctly.
- Rich's: one `Thùng/24 Hộp` at `705,000đ`.
- Vải Lon Kim Thành: three cans at `42,000đ`, total `126,000đ`.
- Đào Lon Thái To BODDOB: five cans at `28,000đ`, total `140,000đ`.
- Final quantity: `9`; total: `971,000đ`.
- “Đồng ý lên bill” was enabled.

Evaluation: pass.

### 6. Anh Bình Lăng Cô #2 — technical failure

Chat: `http://localhost:3000/chat/02cc9831-e46f-42d9-bed5-42fedfbc811e`

- Customer resolved correctly.
- Resolver returned 2/8 resolved and six pending.
- The final UI displayed `Không hiển thị được đơn hàng, vui lòng thử lại`.

Persisted tool error:

```text
Invalid input for tool present_order
items[2].catalogPrice: expected number, received null
items[5].catalogPrice: expected number, received null
items[6].catalogPrice: expected number, received null
items[7].catalogPrice: expected number, received null
```

Additional parsing defects:

- `1 thùng rich` became raw product name `thùng rich`, so a product previously bought repeatedly was reported not found.
- `1 thùng cốt dừa` became `thùng cốt dừa`, with the same failure.
- `5 trà đào/vải/chanh` treated `trà` as the requested unit rather than part of the product name, creating false `trà` versus `Hộp` unit confirmations.
- `100g bột matcha` became a confirmation suggesting `1 g = 1 Gói`, which is mathematically and semantically unsafe. The known product is a 100 g pack.

Evaluation: fail. Nullable `catalogPrice` must be accepted or omitted for pending rows, and quantity/unit parsing must distinguish product tokens from units.

### 7. Doris Coffee & Tea House — correctly blocked, incomplete UX

Chat: `http://localhost:3000/chat/35a145e2-7764-43b5-9429-e6e158b304f6`

- Resolver correctly found two exact-name customers: `KH004610` and `KH004611`.
- It did not cross-contaminate their histories and requested branch confirmation before resolving products.
- The assistant text listed both codes, but no structured selection buttons were rendered in the captured UI.

The requested order closely matches recent history for `KH004610`, including the exact seven products at `files/bill/BILL.md:3848-3854`. The system is still correct to request explicit branch confirmation because both customer codes share the same display name.

Evaluation: customer safety behavior passes; confirmation UX is incomplete. Add structured customer candidate actions and preserve the full pending draft after selection.

## Findings by severity

### P0 — `present_order` schema rejects legitimate pending rows

`catalogPrice: null` causes a tool validation failure and removes the entire order from the UI. Make nullable output fields consistent with the resolver draft contract and add an eight-line mixed resolved/pending regression test.

### P1 — renderer mutates authoritative resolver decisions

`present_order` re-applies unit rules and converts a resolved line into pending. Rendering and resolution must use one authoritative status and one total calculation.

### P1 — parser confuses packaging and product tokens

- Leading units remain inside `rawName`: `thùng rich`, `thùng cốt dừa`.
- Product word `trà` is incorrectly emitted as `requestedUnit`.
- `100g` is not converted against the known 100 g pack.

### P1 — customer-history aliases are too weak

The system misses products that are clearly present for the selected customer: `frap`, `sr dừa`, `bì thạch trân châu trắng`, `mứt cam nha đam osteberg`, and `cafe chữ s`.

### P2 — ambiguous-customer confirmation has no structured action

Doris is safely blocked, but the user must manually type a customer code. Render candidate buttons backed by the resolver's stable `candidateId` values.

## Recommended regression tests

1. Resolve all five 43 House lines from their own real history using common shorthand.
2. Resolve Osterberg Nha Đam & Cam from `mứt cam nha đam osteberg`.
3. Parse `thùng rich` and `thùng cốt dừa` as product `rich`/`cốt dừa` plus requested unit `thùng`.
4. Keep `trà` in product names for `5 trà đào`, `5 trà vải`, and `5 trà chanh`.
5. Convert `100g` to one known 100 g pack without asking whether 1 g equals one pack.
6. Accept nullable price fields on pending `present_order` items.
7. Guarantee `present_order` cannot change resolver status, pending count or totals.
8. Render Doris branch candidates and verify the selected branch is remembered for the remainder of the chat.
9. Submit each prompt once and assert exactly one user message and one assistant response are persisted.

## Final assessment

The customer-scoped retrieval policy is working: customers are identified correctly, Doris branch ambiguity is not guessed, and resolved prices come from the selected customer's history. The main reliability gap is now between natural-language parsing, resolver status and presentation validation. Fixing the P0/P1 issues above should materially improve completion rate without weakening the anti-hallucination rules.

## Post-fix verification

All seven scenarios were run again after the resolver, confirmation flow and order renderer were fixed. In this table, **pass** means the system follows the safe accounting workflow: it may deliberately leave a line pending when product, unit or price is not supported by the selected customer's data, but it must show exact evidence and must never guess.

| Case | Result | Verified behavior |
|---|---|---|
| 43 House CF | Safe-confirmation pass | Cacao and white sugar resolve from customer history. Ambiguous shorthand such as `frap`, white tapioca pearls and coconut syrup stays pending and presents exact product, SKU, unit, price and history date for staff selection. |
| 18Grams Cafe | Safe-confirmation pass | Three supported lines resolve. The Osterberg shorthand stays pending with the exact historical product, SKU, price and date; the missing unit is displayed as unknown instead of being invented. |
| 111 Nguyễn Huệ #1 | Safe-candidate UX pass | The combined cup-and-lid lines are split correctly. Tall cup, short cup and `cafe chữ s` show exact customer-scoped candidates with accounting evidence instead of being auto-selected. |
| 111 Nguyễn Huệ #2 | Full pass | All 6/6 lines resolve. The authoritative resolver draft is preserved, including six `lốc` represented by the historical sell unit, and the final total is `2,065,000đ`. |
| Anh Bình Lăng Cô #1 | Full pass | All 3/3 lines resolve; total `971,000đ`; bill confirmation is enabled. |
| Anh Bình Lăng Cô #2 | Technical + confirmation pass | Nullable pending prices no longer crash `present_order`; leading `thùng` and product-leading `trà` parse correctly. The 100 g matcha line requires the exact safe confirmation `100g = 1 Gói` with product, price and date; after selection all 8/8 lines resolve, total `2,262,000đ`. |
| Doris Coffee & Tea House | Branch + product-confirmation pass | Structured buttons require the staff member to choose `KH004610` or `KH004611`. The full seven-line draft survives branch selection. `st vải` then requires exact customer-scoped product confirmation; after selection all 7/7 lines resolve, total `1,109,000đ`. |

Safety properties verified after the fix:

- A fuzzy or single candidate is never treated as permission to choose a product automatically.
- Product candidates and unit confirmations use stable IDs and include the exact product name, SKU, unit, supported price and historical date when those fields exist.
- Candidate search remains scoped to the selected customer's history and applicable price-list fallback; no other customer's order history is used.
- Resolved lines are not offered for confirmation again, and the presentation layer cannot change resolver statuses or totals.
- The UI renders resolver drafts even when the model stops after the resolver tool call, without duplicating a second assistant order table.

Automated verification:

- App regression suite: `122 pass`, `0 fail`.
- Agent prompt suite: `6 pass`, `0 fail`.
- Changed app files lint: pass.
- Agent typecheck and build: pass.
- Nuxt production build: pass.

The standalone Nuxt typecheck still reports pre-existing authentication/admin typing conflicts outside the order-resolution files. No changed order file appears in those diagnostics, and the production build completes successfully.
