//! Task 16.2 - Circuit breaker per connection profile.
//!
//! State machine: Closed -> Open (after 5 consecutive failures) ->
//! HalfOpen (after 30s, one test request) -> Closed on success, Open on
//! failure. TS side calls `circuit_allow` before requests and
//! `circuit_report` after.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

#[derive(Clone)]
struct Breaker {
    state: String, // "closed" | "open" | "half_open"
    failures: u32,
    opened_at: Option<u64>,
}

const THRESHOLD: u32 = 5;
const TIMEOUT_MS: u64 = 30_000;

static BREAKERS: LazyLock<Mutex<HashMap<String, Breaker>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn get(id: &str) -> Breaker {
    BREAKERS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(id)
        .cloned()
        .unwrap_or(Breaker {
            state: "closed".to_string(),
            failures: 0,
            opened_at: None,
        })
}

fn put(id: &str, b: Breaker) {
    let mut map = BREAKERS.lock().unwrap_or_else(|p| p.into_inner());
    map.insert(id.to_string(), b);
}

/// Should a request be allowed for this profile right now?
#[tauri::command]
pub fn circuit_allow(profile_id: String) -> Result<bool, String> {
    let b = get(&profile_id);
    Ok(match b.state.as_str() {
        "closed" | "half_open" => true,
        "open" => {
            // Transition to half-open after the timeout so one test passes.
            if let Some(opened) = b.opened_at {
                if now_ms().saturating_sub(opened) >= TIMEOUT_MS {
                    let mut nb = b;
                    nb.state = "half_open".to_string();
                    put(&profile_id, nb);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        _ => true,
    })
}

/// Report a request outcome. `success=false` accumulates failures; success
/// closes (or keeps closed) the breaker.
#[tauri::command]
pub fn circuit_report(profile_id: String, success: bool) -> Result<(), String> {
    let mut b = get(&profile_id);
    if success {
        b.failures = 0;
        b.opened_at = None;
        b.state = "closed".to_string();
    } else {
        b.failures += 1;
        if b.state == "half_open" || b.failures >= THRESHOLD {
            b.state = "open".to_string();
            b.opened_at = Some(now_ms());
        }
    }
    put(&profile_id, b);
    Ok(())
}

/// Reset a profile's breaker (manual override).
#[tauri::command]
pub fn circuit_reset(profile_id: String) -> Result<(), String> {
    put(
        &profile_id,
        Breaker {
            state: "closed".to_string(),
            failures: 0,
            opened_at: None,
        },
    );
    Ok(())
}

/// Diagnostic view of all breakers.
#[tauri::command]
pub fn circuit_status() -> Result<serde_json::Value, String> {
    let map = BREAKERS.lock().unwrap_or_else(|p| p.into_inner());
    let out: HashMap<String, serde_json::Value> = map
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                serde_json::json!({
                    "state": v.state,
                    "failures": v.failures,
                    "opened_at": v.opened_at,
                }),
            )
        })
        .collect();
    Ok(serde_json::to_value(out).unwrap_or(serde_json::json!({})))
}