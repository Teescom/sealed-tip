# Issues index

All work to complete `ROADMAP.md`, as GitHub issues in [Teescom/sealed-tip](https://github.com/Teescom/sealed-tip/issues).
Each phase is a milestone. Within a wave, no issue blocks another; a later wave starts after the earlier wave of that phase is merged.
`maintainer` issues need keys, funds or decisions. Contributions are from collaborators only.

## P0 — Decisions & verification (day-1 spikes) (7 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#1](https://github.com/Teescom/sealed-tip/issues/1) | 1 | S-0.10 | S | Research OutLayer as a TEE host for the keeper |
| [#2](https://github.com/Teescom/sealed-tip/issues/2) | 1 | S-0.3 | M | Spike: NEAR AI Cloud attestation + response signature end to end · **maintainer** |
| [#3](https://github.com/Teescom/sealed-tip/issues/3) | 1 | S-0.4 | S | Spike: can the browser use NEAR AI Cloud E2EE? · **maintainer** |
| [#4](https://github.com/Teescom/sealed-tip/issues/4) | 1 | S-0.5 | M | Spike: one TS↔Rust borsh + ed25519 vector |
| [#5](https://github.com/Teescom/sealed-tip/issues/5) | 1 | S-0.6 | S | $1 mainnet check of the 1Click NEP-141 deposit method · **maintainer** |
| [#6](https://github.com/Teescom/sealed-tip/issues/6) | 1 | S-0.7 | S | Verify Sputnik factory accounts and pin the wasm |
| [#7](https://github.com/Teescom/sealed-tip/issues/7) | 1 | S-0.9 | S | Create and fund the testnet accounts · **maintainer** |

## P1 — Scaffolding (4 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#8](https://github.com/Teescom/sealed-tip/issues/8) | 1 | S-1.5 | S | mock-ft: implement NEP-141 + NEP-145 with open mint |
| [#9](https://github.com/Teescom/sealed-tip/issues/9) | 1 | S-1.6 | S | sandbox harness: deploy sealedtip and call `new` |
| [#10](https://github.com/Teescom/sealed-tip/issues/10) | 1 | S-1.9 | S | CI: install cargo-near and run on every push |
| [#11](https://github.com/Teescom/sealed-tip/issues/11) | 2 | S-1.6 | S | sandbox harness: add mock-ft, panel members and a test signing key |

## P2 — Contract core (26 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#12](https://github.com/Teescom/sealed-tip/issues/12) | 1 | S-2.10 | XS | token: implement `ft_transfer` |
| [#13](https://github.com/Teescom/sealed-tip/issues/13) | 1 | S-2.10 | XS | token: implement `storage_deposit` |
| [#14](https://github.com/Teescom/sealed-tip/issues/14) | 1 | S-2.11 | XS | views: implement `get_programme` |
| [#15](https://github.com/Teescom/sealed-tip/issues/15) | 1 | S-2.11 | XS | views: implement `list_programmes` |
| [#16](https://github.com/Teescom/sealed-tip/issues/16) | 1 | S-2.11 | XS | views: implement `get_tip_public` |
| [#17](https://github.com/Teescom/sealed-tip/issues/17) | 1 | S-2.11 | XS | views: implement `get_tip_for_panel` |
| [#18](https://github.com/Teescom/sealed-tip/issues/18) | 1 | S-2.12 | S | test utils: unit-test state builders |
| [#19](https://github.com/Teescom/sealed-tip/issues/19) | 1 | S-2.2 | XS | events: implement `emit` (NEP-297) |
| [#20](https://github.com/Teescom/sealed-tip/issues/20) | 1 | S-2.3 | XS | time: implement `scaled` |
| [#21](https://github.com/Teescom/sealed-tip/issues/21) | 1 | S-2.4 | XS | actions: implement `action_message` |
| [#22](https://github.com/Teescom/sealed-tip/issues/22) | 1 | S-2.4 | XS | actions: implement `submit_message` |
| [#23](https://github.com/Teescom/sealed-tip/issues/23) | 1 | S-2.4 | XS | actions: implement `assert_signature` |
| [#24](https://github.com/Teescom/sealed-tip/issues/24) | 1 | S-2.5 | XS | pow: implement `leading_zero_bits` |
| [#25](https://github.com/Teescom/sealed-tip/issues/25) | 1 | S-2.7 | XS | access: implement `assert_funder` |
| [#26](https://github.com/Teescom/sealed-tip/issues/26) | 1 | S-2.7 | XS | access: implement `assert_panel_dao` |
| [#27](https://github.com/Teescom/sealed-tip/issues/27) | 1 | S-2.7 | XS | access: implement `assert_panel_member` |
| [#28](https://github.com/Teescom/sealed-tip/issues/28) | 1 | S-2.9 | XS | admin: implement `set_relayers` |
| [#29](https://github.com/Teescom/sealed-tip/issues/29) | 1 | S-2.9 | XS | admin: implement `set_keeper` |
| [#30](https://github.com/Teescom/sealed-tip/issues/30) | 2 | S-2.10 | S | token: implement `on_claim_paid` rollback |
| [#31](https://github.com/Teescom/sealed-tip/issues/31) | 2 | S-2.11 | XS | views: implement `get_programme_stats` |
| [#32](https://github.com/Teescom/sealed-tip/issues/32) | 2 | S-2.5 | XS | pow: implement `check` |
| [#33](https://github.com/Teescom/sealed-tip/issues/33) | 2 | S-2.6 | S | programme: implement `create_programme` |
| [#34](https://github.com/Teescom/sealed-tip/issues/34) | 2 | S-2.6 | S | programme: implement `withdraw_unreserved` |
| [#35](https://github.com/Teescom/sealed-tip/issues/35) | 2 | S-2.6 | S | programme: implement `close_programme` |
| [#36](https://github.com/Teescom/sealed-tip/issues/36) | 2 | S-2.8 | S | programme: implement `set_panel` |
| [#37](https://github.com/Teescom/sealed-tip/issues/37) | 3 | S-2.6 | XS | ft_on_transfer: fund programmes and reserve Unfunded tips |

## P3 — Tips, claims, switch (10 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#38](https://github.com/Teescom/sealed-tip/issues/38) | 1 | S-3.1 | M | tip: implement `submit_tip` |
| [#39](https://github.com/Teescom/sealed-tip/issues/39) | 1 | S-3.2 | S | tip: implement `triage` |
| [#40](https://github.com/Teescom/sealed-tip/issues/40) | 1 | S-3.3 | S | tip: implement `resolve_tip` |
| [#41](https://github.com/Teescom/sealed-tip/issues/41) | 1 | S-3.4 | S | tip: implement `retract` |
| [#42](https://github.com/Teescom/sealed-tip/issues/42) | 1 | S-3.5 | M | claim: implement `claim` |
| [#43](https://github.com/Teescom/sealed-tip/issues/43) | 1 | S-3.6 | XS | switch: implement `checkin` |
| [#44](https://github.com/Teescom/sealed-tip/issues/44) | 1 | S-3.7 | XS | switch: implement `trigger` |
| [#45](https://github.com/Teescom/sealed-tip/issues/45) | 1 | S-3.8 | XS | switch: implement `post_released_keys` |
| [#46](https://github.com/Teescom/sealed-tip/issues/46) | 1 | S-3.8 | XS | switch: implement `heartbeat` |
| [#47](https://github.com/Teescom/sealed-tip/issues/47) | 1 | S-3.9 | XS | programme: reserve Unfunded tips oldest-first when funded |

## P4 — Testnet (1 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#48](https://github.com/Teescom/sealed-tip/issues/48) | 1 | S-4.1 | S | Deploy contracts and the panel DAO to testnet · **maintainer** |

## P5 — Integration test suite (33 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#49](https://github.com/Teescom/sealed-tip/issues/49) | 1 | S-5.1 | S | test: `reservations::submission_reserves_nothing` |
| [#50](https://github.com/Teescom/sealed-tip/issues/50) | 1 | S-5.1 | S | test: `reservations::credible_triage_reserves_max_reward` |
| [#51](https://github.com/Teescom/sealed-tip/issues/51) | 1 | S-5.1 | S | test: `reservations::dismiss_releases_nothing_reserved` |
| [#52](https://github.com/Teescom/sealed-tip/issues/52) | 1 | S-5.1 | S | test: `reservations::withdraw_of_reserved_funds_fails` |
| [#53](https://github.com/Teescom/sealed-tip/issues/53) | 1 | S-5.1 | S | test: `reservations::unfunded_tip_reserved_when_programme_funded` |
| [#54](https://github.com/Teescom/sealed-tip/issues/54) | 1 | S-5.1 | S | test: `reservations::reject_releases_reservation` |
| [#55](https://github.com/Teescom/sealed-tip/issues/55) | 1 | S-5.2 | S | test: `submission::pow_below_threshold_fails` |
| [#56](https://github.com/Teescom/sealed-tip/issues/56) | 1 | S-5.2 | S | test: `submission::bad_submit_signature_fails` |
| [#57](https://github.com/Teescom/sealed-tip/issues/57) | 1 | S-5.2 | S | test: `submission::fewer_than_two_sealed_keys_fails` |
| [#58](https://github.com/Teescom/sealed-tip/issues/58) | 1 | S-5.2 | S | test: `submission::sealed_key_to_recused_member_fails` |
| [#59](https://github.com/Teescom/sealed-tip/issues/59) | 1 | S-5.2 | S | test: `submission::non_relayer_cannot_submit` |
| [#60](https://github.com/Teescom/sealed-tip/issues/60) | 1 | S-5.2 | S | test: `submission::closed_programme_rejects_tips` |
| [#61](https://github.com/Teescom/sealed-tip/issues/61) | 1 | S-5.3 | S | test: `signed_actions::wrong_key_fails` |
| [#62](https://github.com/Teescom/sealed-tip/issues/62) | 1 | S-5.3 | S | test: `signed_actions::changed_payout_fails` |
| [#63](https://github.com/Teescom/sealed-tip/issues/63) | 1 | S-5.3 | S | test: `signed_actions::replayed_nonce_fails` |
| [#64](https://github.com/Teescom/sealed-tip/issues/64) | 1 | S-5.3 | S | test: `signed_actions::retract_after_decision_fails` |
| [#65](https://github.com/Teescom/sealed-tip/issues/65) | 1 | S-5.4 | S | test: `triage_and_resolve::recused_member_cannot_triage` |
| [#66](https://github.com/Teescom/sealed-tip/issues/66) | 1 | S-5.4 | S | test: `triage_and_resolve::resolve_tip_only_from_panel_dao` |
| [#67](https://github.com/Teescom/sealed-tip/issues/67) | 1 | S-5.4 | S | test: `triage_and_resolve::reward_above_max_fails` |
| [#68](https://github.com/Teescom/sealed-tip/issues/68) | 1 | S-5.4 | S | test: `triage_and_resolve::accept_releases_unused_reservation` |
| [#69](https://github.com/Teescom/sealed-tip/issues/69) | 1 | S-5.5 | S | test: `claims::claim_registers_storage_and_sends_gas_drip` |
| [#70](https://github.com/Teescom/sealed-tip/issues/70) | 1 | S-5.5 | S | test: `claims::claim_only_when_accepted` |
| [#71](https://github.com/Teescom/sealed-tip/issues/71) | 1 | S-5.5 | S | test: `claims::failed_transfer_rolls_back_to_accepted` |
| [#72](https://github.com/Teescom/sealed-tip/issues/72) | 1 | S-5.6 | S | test: `switch::trigger_before_deadline_plus_grace_fails` |
| [#73](https://github.com/Teescom/sealed-tip/issues/73) | 1 | S-5.6 | S | test: `switch::checkin_extends_deadline` |
| [#74](https://github.com/Teescom/sealed-tip/issues/74) | 1 | S-5.6 | S | test: `switch::only_keeper_posts_released_keys` |
| [#75](https://github.com/Teescom/sealed-tip/issues/75) | 1 | S-5.6 | S | test: `switch::released_keys_exclude_recused_members` |
| [#76](https://github.com/Teescom/sealed-tip/issues/76) | 1 | S-5.6 | S | test: `switch::heartbeat_updates_last_seen` |
| [#77](https://github.com/Teescom/sealed-tip/issues/77) | 1 | S-5.7 | S | test: `access_control::owner_cannot_touch_funds_or_tips` |
| [#78](https://github.com/Teescom/sealed-tip/issues/78) | 1 | S-5.7 | S | test: `access_control::time_scale_cannot_change` |
| [#79](https://github.com/Teescom/sealed-tip/issues/79) | 1 | S-5.8 | S | test: `vectors::borsh_bytes_match_fixture_vectors` |
| [#80](https://github.com/Teescom/sealed-tip/issues/80) | 1 | S-5.8 | S | test: `vectors::signatures_match_fixture_vectors` |
| [#81](https://github.com/Teescom/sealed-tip/issues/81) | 1 | S-5.9 | S | lint: make clippy and rustfmt clean |

## P6 — Shared packages (27 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#82](https://github.com/Teescom/sealed-tip/issues/82) | 1 | S-6.1 | XS | core: test the zod schemas against sample view JSON |
| [#83](https://github.com/Teescom/sealed-tip/issues/83) | 1 | S-6.12 | XS | fixtures: create `invoice_fictional.pdf` |
| [#84](https://github.com/Teescom/sealed-tip/issues/84) | 1 | S-6.12 | XS | fixtures: create `photo_gps.jpg` |
| [#85](https://github.com/Teescom/sealed-tip/issues/85) | 1 | S-6.12 | XS | fixtures: create `scan_with_dots.png` |
| [#86](https://github.com/Teescom/sealed-tip/issues/86) | 1 | S-6.12 | XS | fixtures: create `memo.docx` |
| [#87](https://github.com/Teescom/sealed-tip/issues/87) | 1 | S-6.2 | S | contract.ts: implement `createViewClient` |
| [#88](https://github.com/Teescom/sealed-tip/issues/88) | 1 | S-6.3 | XS | keys.ts: implement `newSecret` |
| [#89](https://github.com/Teescom/sealed-tip/issues/89) | 1 | S-6.3 | XS | keys.ts: implement `secretToWords` |
| [#90](https://github.com/Teescom/sealed-tip/issues/90) | 1 | S-6.3 | XS | keys.ts: implement `wordsToSecret` |
| [#91](https://github.com/Teescom/sealed-tip/issues/91) | 1 | S-6.3 | XS | keys.ts: implement `deriveKeys` |
| [#92](https://github.com/Teescom/sealed-tip/issues/92) | 1 | S-6.4 | XS | actions.ts: implement `actionMessage` |
| [#93](https://github.com/Teescom/sealed-tip/issues/93) | 1 | S-6.4 | XS | actions.ts: implement `submitMessage` |
| [#94](https://github.com/Teescom/sealed-tip/issues/94) | 1 | S-6.4 | XS | actions.ts: implement `sign` |
| [#95](https://github.com/Teescom/sealed-tip/issues/95) | 1 | S-6.5 | XS | seal.ts: implement `encryptBundle` |
| [#96](https://github.com/Teescom/sealed-tip/issues/96) | 1 | S-6.5 | XS | seal.ts: implement `decryptBundle` |
| [#97](https://github.com/Teescom/sealed-tip/issues/97) | 1 | S-6.5 | XS | seal.ts: implement `sealTo` |
| [#98](https://github.com/Teescom/sealed-tip/issues/98) | 1 | S-6.5 | XS | seal.ts: implement `openSealed` |
| [#99](https://github.com/Teescom/sealed-tip/issues/99) | 1 | S-6.5 | XS | seal.ts: implement `cidOf` |
| [#100](https://github.com/Teescom/sealed-tip/issues/100) | 1 | S-6.6 | XS | pow.ts: implement `checkPow` |
| [#101](https://github.com/Teescom/sealed-tip/issues/101) | 1 | S-6.7 | S | gate.ts: implement `sniffType` |
| [#102](https://github.com/Teescom/sealed-tip/issues/102) | 2 | S-6.10 | S | scan.ts: implement `scanMode` |
| [#103](https://github.com/Teescom/sealed-tip/issues/103) | 2 | S-6.11 | S | report.ts: implement `buildReport` |
| [#104](https://github.com/Teescom/sealed-tip/issues/104) | 2 | S-6.13 | XS | sign-statement.ts: implement `main` |
| [#105](https://github.com/Teescom/sealed-tip/issues/105) | 2 | S-6.4 | XS | gen-vectors.ts: implement `main` |
| [#106](https://github.com/Teescom/sealed-tip/issues/106) | 2 | S-6.6 | XS | pow.ts: implement `solvePow` |
| [#107](https://github.com/Teescom/sealed-tip/issues/107) | 2 | S-6.8 | S | pdf.ts: implement `rasterisePdf` |
| [#108](https://github.com/Teescom/sealed-tip/issues/108) | 2 | S-6.9 | S | image.ts: implement `reencodeImage` |

## P7 — Scripts & seed (2 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#109](https://github.com/Teescom/sealed-tip/issues/109) | 1 | S-7.1 | M | scripts: write `deploy-testnet.ts` · **maintainer** |
| [#110](https://github.com/Teescom/sealed-tip/issues/110) | 1 | S-7.2 | M | scripts: write `seed.ts` · **maintainer** |

## P8 — API (8 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#111](https://github.com/Teescom/sealed-tip/issues/111) | 1 | S-8.1 | XS | api: implement `noLogs` and its test |
| [#112](https://github.com/Teescom/sealed-tip/issues/112) | 1 | S-8.2 | XS | api: load env with `loadEnv` |
| [#113](https://github.com/Teescom/sealed-tip/issues/113) | 1 | S-8.3 | S | api: implement the blob store |
| [#114](https://github.com/Teescom/sealed-tip/issues/114) | 1 | S-8.4 | XS | ratelimit.ts: implement `allow` |
| [#115](https://github.com/Teescom/sealed-tip/issues/115) | 1 | S-8.4 | XS | queue.ts: implement `enqueue` |
| [#116](https://github.com/Teescom/sealed-tip/issues/116) | 1 | S-8.4 | M | api: implement `submit` and `POST /relay/:action` · **maintainer** |
| [#117](https://github.com/Teescom/sealed-tip/issues/117) | 1 | S-8.5 | M | api: AI redaction proxy + attestation bundle |
| [#118](https://github.com/Teescom/sealed-tip/issues/118) | 1 | S-8.6 | S | api: 1Click quote proxy |

## P9 — Keeper (3 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#119](https://github.com/Teescom/sealed-tip/issues/119) | 1 | S-9.1 | S | heartbeat.ts: implement `startHeartbeat` |
| [#120](https://github.com/Teescom/sealed-tip/issues/120) | 1 | S-9.2 | S | watch.ts: implement `watchTriggers` |
| [#121](https://github.com/Teescom/sealed-tip/issues/121) | 1 | S-9.3 | S | release.ts: implement `release` |

## P10 — Web app (17 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#122](https://github.com/Teescom/sealed-tip/issues/122) | 1 | S-10.1 | S | web: verify the strict CSP blocks third-party loads |
| [#123](https://github.com/Teescom/sealed-tip/issues/123) | 1 | S-10.10 | S | web: configure Vitest for React components |
| [#124](https://github.com/Teescom/sealed-tip/issues/124) | 1 | S-10.2 | S | web: write the landing page with Tor guidance |
| [#125](https://github.com/Teescom/sealed-tip/issues/125) | 1 | S-10.3 | S | web: build the `KeeperStatus` component |
| [#126](https://github.com/Teescom/sealed-tip/issues/126) | 1 | S-10.4 | S | web: build the `CleaningReportView` component |
| [#127](https://github.com/Teescom/sealed-tip/issues/127) | 1 | S-10.4 | S | web: build the `RedactionReview` component |
| [#128](https://github.com/Teescom/sealed-tip/issues/128) | 1 | S-10.4 | S | web: build the `AttestationPanel` component |
| [#129](https://github.com/Teescom/sealed-tip/issues/129) | 1 | S-10.4 | S | web: build the `RecoveryWords` component |
| [#130](https://github.com/Teescom/sealed-tip/issues/130) | 1 | S-10.4 | S | web: build the `RecusalPicker` component |
| [#131](https://github.com/Teescom/sealed-tip/issues/131) | 1 | S-10.4 | S | web: build the `SwitchSettings` component |
| [#132](https://github.com/Teescom/sealed-tip/issues/132) | 2 | S-10.3 | M | web: build the `/p/[id]` page |
| [#133](https://github.com/Teescom/sealed-tip/issues/133) | 2 | S-10.4 | M | web: build the `/submit/[programme]` page |
| [#134](https://github.com/Teescom/sealed-tip/issues/134) | 2 | S-10.5 | M | web: build the `/status` page |
| [#135](https://github.com/Teescom/sealed-tip/issues/135) | 2 | S-10.6 | M | web: build the `/claim` page |
| [#136](https://github.com/Teescom/sealed-tip/issues/136) | 2 | S-10.7 | M | web: build the `/panel` page |
| [#137](https://github.com/Teescom/sealed-tip/issues/137) | 2 | S-10.8 | M | web: build the `/programmes/new` page |
| [#138](https://github.com/Teescom/sealed-tip/issues/138) | 3 | S-10.9 | S | web: accessibility and mobile pass |

## P11 — Demo (10 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#139](https://github.com/Teescom/sealed-tip/issues/139) | 1 | S-11.1 | S | demo: write step 1 as `scripts/demo/step1.ts` |
| [#140](https://github.com/Teescom/sealed-tip/issues/140) | 1 | S-11.2 | S | demo: write step 2 as `scripts/demo/step2.ts` |
| [#141](https://github.com/Teescom/sealed-tip/issues/141) | 1 | S-11.3 | S | demo: write step 3 as `scripts/demo/step3.ts` |
| [#142](https://github.com/Teescom/sealed-tip/issues/142) | 1 | S-11.4 | S | demo: write step 4 as `scripts/demo/step4.ts` |
| [#143](https://github.com/Teescom/sealed-tip/issues/143) | 1 | S-11.4 | S | demo: write `scripts/spam.ts` |
| [#144](https://github.com/Teescom/sealed-tip/issues/144) | 1 | S-11.5 | S | demo: write step 5 as `scripts/demo/step5.ts` |
| [#145](https://github.com/Teescom/sealed-tip/issues/145) | 1 | S-11.6 | S | demo: write step 6 as `scripts/demo/step6.ts` |
| [#146](https://github.com/Teescom/sealed-tip/issues/146) | 1 | S-11.7 | S | demo: write step 7 as `scripts/demo/step7.ts` |
| [#147](https://github.com/Teescom/sealed-tip/issues/147) | 1 | S-11.8 | S | demo: write step 8 as `scripts/demo/step8.ts` |
| [#148](https://github.com/Teescom/sealed-tip/issues/148) | 2 | S-11.9 | XS | demo: wire steps into `scripts/demo.ts` |

## P12 — Documentation, deployment, submission (9 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#149](https://github.com/Teescom/sealed-tip/issues/149) | 1 | S-12.1 | S | README: problem and sources |
| [#150](https://github.com/Teescom/sealed-tip/issues/150) | 1 | S-12.1 | S | README: how it protects you + diagram |
| [#151](https://github.com/Teescom/sealed-tip/issues/151) | 1 | S-12.3 | S | README: trust assumptions and threat model |
| [#152](https://github.com/Teescom/sealed-tip/issues/152) | 1 | S-12.4 | S | README: libraries and AI disclosure |
| [#153](https://github.com/Teescom/sealed-tip/issues/153) | 1 | S-12.5 | S | Deploy the web app to Vercel (testnet) · **maintainer** |
| [#154](https://github.com/Teescom/sealed-tip/issues/154) | 1 | S-12.6 | S | Record the demo video (≤ 2 min) · **maintainer** |
| [#155](https://github.com/Teescom/sealed-tip/issues/155) | 1 | S-12.7 | S | Draft the X post · **maintainer** |
| [#156](https://github.com/Teescom/sealed-tip/issues/156) | 1 | S-12.9 | S | Submit the hackathon form · **maintainer** |
| [#157](https://github.com/Teescom/sealed-tip/issues/157) | 2 | S-12.2 | S | README: 'do X, see Y' quickstart |

## P13 — Final QA (6 issues)

| # | Wave | Roadmap | Size | Issue |
|---|---|---|---|---|
| [#158](https://github.com/Teescom/sealed-tip/issues/158) | 1 | S-13.1 | XS | Full lint + test run |
| [#159](https://github.com/Teescom/sealed-tip/issues/159) | 1 | S-13.2 | XS | Fresh-clone test using only the README |
| [#160](https://github.com/Teescom/sealed-tip/issues/160) | 1 | S-13.3 | XS | AI-judge dry run |
| [#161](https://github.com/Teescom/sealed-tip/issues/161) | 1 | S-13.4 | XS | Secrets + privacy audit |
| [#162](https://github.com/Teescom/sealed-tip/issues/162) | 1 | S-13.5 | XS | Docs consistency check |
| [#163](https://github.com/Teescom/sealed-tip/issues/163) | 1 | S-13.6 | S | Commit history check · **maintainer** |
