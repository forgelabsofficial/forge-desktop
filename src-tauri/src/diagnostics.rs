//! Task 15 - Logging + rotation + diagnostic export.
//!
//! Zero extra crates: a static ring buffer (1000 entries) plus optional
//! file persistence with 10MB rotation keeping the last 5 files
//! (`forge-desktop-{date}.log`).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(serde::Serialize, Clone)]
pub struct LogEntry {
    pub ts: String,
    pub level: String,
    pub msg: String,
}

static RING: Mutex<Vec<LogEntry>> = Mutex::new(Vec::new());
static FILE_SINK: Mutex<bool> = Mutex::new(true);

const RING_CAP: usize = 1000;
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10MB
const KEEP_FILES: usize = 5;

fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let secs = now / 1000;
    let millis = now % 1000;
    let days = secs / 86400;
    let rem = secs % 86400;
    let (y, mo, d) = civil_from_days(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        mo,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        millis
    )
}

fn today() -> String {
    now_iso()[..10].to_string()
}

/// Convert days since 1970-01-01 to (year, month, day) - Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn write_rotated(dir: &PathBuf, date: &str, content: &str) -> Result<(), String> {
    let path = dir.join(format!("forge-desktop-{}.log", date));
    if path.exists() && path.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
        // Rotate: shift slots down, keep KEEP_FILES.
        for slot in (1..KEEP_FILES).rev() {
            let _ = fs::remove_file(dir.join(format!("forge-desktop-{}.log.{}", date, slot)));
            let src = dir.join(format!("forge-desktop-{}.log.{}", date, slot - 1));
            if src.exists() {
                let _ = fs::rename(&src, dir.join(format!("forge-desktop-{}.log.{}", date, slot)));
            }
        }
        let _ = fs::rename(
            &path,
            dir.join(format!("forge-desktop-{}.log.0", date)),
        );
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Append one log line (called from TypeScript). Rotates at 10MB, keeps 5.
#[tauri::command]
pub fn log_append(app: tauri::AppHandle, level: String, message: String) -> Result<(), String> {
    let entry = LogEntry {
        ts: now_iso(),
        level,
        msg: message,
    };

    {
        let mut ring = RING.lock().map_err(|_| "ring poisoned".to_string())?;
        ring.push(entry.clone());
        let excess = ring.len().saturating_sub(RING_CAP);
        if excess > 0 {
            ring.drain(0..excess);
        }
    }

    if *FILE_SINK.lock().map_err(|_| "sink poisoned".to_string())? {
        let dir = app
            .path()
            .app_log_dir()
            .map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let line = format!("{} [{}] {}\n", entry.ts, entry.level, entry.msg);
        let _ = write_rotated(&dir, &today(), &line);
    }
    Ok(())
}

/// Task 15.3 - Collect diagnostics: last 1000 log entries + system info.
#[tauri::command]
pub fn diagnostics_collect() -> Result<serde_json::Value, String> {
    let logs = {
        let ring = RING.lock().map_err(|_| "ring poisoned".to_string())?;
        ring.clone()
    };
    Ok(serde_json::json!({
        "collected_at": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        "log_count": logs.len(),
        "logs": logs,
        "system": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "family": std::env::consts::FAMILY,
            "version": env!("CARGO_PKG_VERSION"),
        },
    }))
}

/// Turn file persistence off (used by bandwidth-saver / "diagnostics only").
#[tauri::command]
pub fn log_set_file_sink(enabled: bool) -> Result<(), String> {
    let mut sink = FILE_SINK.lock().map_err(|_| "sink poisoned".to_string())?;
    *sink = enabled;
    Ok(())
}