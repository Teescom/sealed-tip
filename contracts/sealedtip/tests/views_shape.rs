//! Shape parity for the read side (S-6.2). `fixtures/views.json` is the file `packages/core` parses:
//! the zod schemas in `types.ts` and the view client in `contract.ts` are both written against it, so it
//! has to be what the deployed wasm returns, not what someone remembered it returning.
//!
//! This test replays the capture scenario against real wasm over RPC and compares the live JSON with the
//! fixture — same fields, same JSON types, and same values except for the handful that are the chain
//! clock. It is the read-side twin of `tests/vectors.rs` (S-5.8): that file locks the *write* encoding
//! TypeScript produces, this one locks the *read* encoding TypeScript consumes.
//!
//! Refresh the fixture the same way it was made: print the views here and write them out. What must
//! never happen is editing the fixture to make this test pass without re-capturing it.
mod common;

use common::{Env, Submission};
use serde_json::{json, Value};

const VIEWS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/views.json");

const HOUR_NS: u64 = 3_600_000_000_000;
const DAY_NS: u64 = 24 * HOUR_NS;
/// Demo mode, as in the capture: `time_scale` 1440 compresses a day to a minute.
const DEMO_INTERVAL_NS: u64 = 60_000_000_000;
const DEMO_GRACE_NS: u64 = 10_000_000_000;
const DEMO_DUE_NS: u64 = DEMO_INTERVAL_NS + DEMO_GRACE_NS + 2_000_000_000;

/// Fields whose value is the chain clock, which a fixture captured on another block cannot repeat. Their
/// JSON *type* is still checked, so a `U64` that became a raw `u64` fails here rather than in a browser.
const CLOCK_FIELDS: [&str; 4] = [
    "created_at",
    "submitted_at",
    "next_deadline",
    "switch_deadline",
];

/// The JSON type of a value, in the words an error message should use.
fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(n) => {
            if n.is_u64() || n.is_i64() {
                "number"
            } else {
                "decimal number"
            }
        }
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn is_clock(path: &str) -> bool {
    CLOCK_FIELDS.iter().any(|field| path.ends_with(field))
}

/// Compare one node of live view JSON against the fixture, collecting every difference rather than
/// stopping at the first — a struct that gained two fields should say so twice.
fn compare(path: &str, live: &Value, want: &Value, diffs: &mut Vec<String>) {
    if kind(live) != kind(want) {
        diffs.push(format!(
            "{path}: the wasm returns a {} but the fixture holds a {}",
            kind(live),
            kind(want)
        ));
        return;
    }
    match (live, want) {
        (Value::Object(live), Value::Object(want)) => {
            for key in live.keys().filter(|key| !want.contains_key(*key)) {
                diffs.push(format!("{path}.{key}: the fixture has no such field"));
            }
            for key in want.keys().filter(|key| !live.contains_key(*key)) {
                diffs.push(format!("{path}.{key}: the field is gone from the wasm"));
            }
            for key in live.keys().filter(|key| want.contains_key(*key)) {
                compare(&format!("{path}.{key}"), &live[key], &want[key], diffs);
            }
        }
        (Value::Array(live), Value::Array(want)) => {
            if live.len() != want.len() {
                diffs.push(format!(
                    "{path}: {} rows from the wasm, {} in the fixture",
                    live.len(),
                    want.len()
                ));
                return;
            }
            for (index, (a, b)) in live.iter().zip(want).enumerate() {
                compare(&format!("{path}[{index}]"), a, b, diffs);
            }
        }
        _ => {
            if !is_clock(path) && live != want {
                diffs.push(format!(
                    "{path}: the wasm says {live} and the fixture says {want}"
                ));
            }
        }
    }
}

fn fixture() -> Value {
    let text = std::fs::read_to_string(VIEWS).expect("fixtures/views.json is not readable");
    serde_json::from_str(&text).expect("fixtures/views.json is not JSON")
}

/// The capture scenario, replayed: a funded programme at demo scale, one tip sealed to two of three panel
/// members with the third recused, a switch armed, fired, and the keeper's release posted.
async fn capture(env: &Env) -> (u64, u64) {
    let programme_id = env.funded_programme_scaled(500, 1_000, 1440).await;
    let tip_id = env
        .submit(
            &env.relayer_1,
            Submission {
                sealed: vec![env.member_1.id().clone(), env.member_3.id().clone()],
                recused: vec![env.member_2.id().clone()],
                switch: Some((DAY_NS, 4 * HOUR_NS)),
                ..Submission::new(programme_id, &env.member_1, &env.member_3)
            },
        )
        .await
        .expect("a submission that recuses a panel member");
    env.advance(DEMO_DUE_NS).await;
    env.call(&env.root, "trigger", json!({ "tip_id": tip_id }))
        .await
        .expect("the switch is due");
    env.post_keys(&env.keeper, tip_id, &[&env.member_1, &env.member_3])
        .await
        .expect("the non-recused members are served");
    (programme_id, tip_id)
}

#[tokio::test]
async fn the_deployed_wasm_returns_the_shape_the_typescript_types_parse() {
    let env = Env::setup().await;
    let (programme_id, tip_id) = capture(&env).await;
    let views = fixture();

    let list = env
        .sealedtip
        .view("list_programmes")
        .args_json(json!({ "from_index": 0, "limit": 10 }))
        .await
        .expect("list_programmes view failed")
        .json::<Value>()
        .expect("list_programmes is not JSON");

    let programme = env.programme_view(programme_id).await;
    let stats = env.programme_stats(programme_id).await;
    let public = env.tip_public(tip_id).await;
    let tip = env.tip_view(tip_id).await;
    let keeper = env.keeper_info().await;

    let live: [(&str, &Value); 6] = [
        ("get_programme", &programme),
        ("get_programme_stats", &stats),
        ("list_programmes", &list),
        ("get_tip_public", &public),
        ("get_tip_for_panel", &tip),
        ("get_keeper_info", &keeper),
    ];

    // One comparison pass so a struct that drifted in three places reports three differences, not one per
    // run of a test that costs a sandbox node.
    let mut diffs: Vec<String> = Vec::new();
    for (method, value) in live {
        compare(method, value, &views[method], &mut diffs);
    }
    assert!(
        diffs.is_empty(),
        "fixtures/views.json no longer describes the deployed contract ({} difference(s)):\n{}\n\
         re-capture it from this scenario — `packages/core` parses it as the chain's own shape",
        diffs.len(),
        diffs.join("\n")
    );

    // Two rules the TypeScript mirror rests on that only the wasm can state.
    //
    // `U128`, `U64` and `NearToken` serialize as decimal *strings*; a bare `u64`/`u32`/`u8` as a JSON
    // number. Getting that line wrong loses precision on a nanosecond timestamp, so `types.ts` splits on
    // exactly this distinction and this is what keeps the split true.
    for field in [
        "max_reward",
        "balance",
        "reserved",
        "ops_balance",
        "gas_drip",
        "created_at",
    ] {
        assert!(
            programme[field].is_string(),
            "{field} is not a decimal string: {programme}",
        );
    }
    for field in ["id", "pow_bits", "time_scale"] {
        assert!(
            programme[field].is_number(),
            "{field} is not a JSON number: {programme}",
        );
    }
    assert!(
        stats["keeper_last_seen"].is_string(),
        "keeper_last_seen: {stats}",
    );
    for field in [
        "programme_id",
        "submitted",
        "under_review",
        "accepted",
        "rejected",
        "paid",
    ] {
        assert!(
            stats[field].is_number(),
            "{field} is not a JSON number: {stats}"
        );
    }
    // The contract stores `evidence_cid` as whatever `String` the tipster signed, unvalidated. That is why
    // `Cid` in `types.ts` cannot demand 64 hex: anyone can put anything there, and a schema that refused it
    // turns one hostile tip into a panel UI that throws on every read. The strict form has its own schema,
    // `HexCid`, and the blob store guards with that one.
    assert_eq!(tip["evidence_cid"], json!("0a1b2c-17"));

    // An `Option` field on a struct arrives as `null`, present under its own key — never missing, which is
    // the difference between `nullable()` and `optional()` in the mirror.
    assert!(tip["attestation_hash"].is_null(), "{tip}");
    assert!(tip["triaged_by"].is_null(), "{tip}");
    assert!(
        tip.as_object()
            .expect("a tip serializes as an object")
            .contains_key("attestation_hash"),
        "an Option field was left out of the JSON instead of written as null: {tip}"
    );
}
