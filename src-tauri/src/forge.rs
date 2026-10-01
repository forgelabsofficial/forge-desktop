use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(serde::Serialize)]
pub struct ForgeResponse {
    pub status: u16,
    pub body: String,
}

/// Upper bound on the TCP connect phase.
///
/// The blocking `TcpStream::connect` uses the OS default SYN retry schedule,
/// which on Windows takes ~21s to give up on an unreachable host. Combined with
/// the frontend retry loop (api.ts allows 3 retries for GET) a single
/// `/api/status` check against an offline device froze the UI for ~65s.
///
/// A device on the LAN answers in milliseconds or not at all, so a short
/// connect timeout is safe and turns that stall into a sub-second failure.
/// Read/write keep using the caller's full timeout.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

fn connect(host: &str, port: u16, timeout_secs: u64) -> Result<TcpStream, String> {
    let timeout = Duration::from_secs(timeout_secs);
    let addr = format!("{}:{}", host, port);

    // Resolve first: `connect_timeout` needs a concrete SocketAddr, so the
    // name lookup has to happen before we can bound the handshake.
    let resolved = match addr.parse::<std::net::SocketAddr>() {
        Ok(sock) => sock,
        Err(_) => {
            use std::net::ToSocketAddrs;
            addr.to_socket_addrs()
                .map_err(|e| format!("invalid address {}: {}", addr, e))?
                .next()
                .ok_or_else(|| format!("no address for {}", addr))?
        }
    };

    let stream = TcpStream::connect_timeout(&resolved, CONNECT_TIMEOUT)
        .map_err(|e| format!("connect failed: {}", e))?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| e.to_string())?;
    Ok(stream)
}

fn read_response(mut stream: TcpStream) -> Result<(u16, Vec<u8>), String> {
    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("read failed: {}", e))?;

    let sep = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response".to_string())?;

    let head = String::from_utf8_lossy(&raw[..sep]).to_string();
    let body = raw[sep + 4..].to_vec();

    let status: u16 = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "missing status line".to_string())?;

    Ok((status, body))
}

/// Low-level HTTP 1.1 request returning raw status + body bytes (binary-safe).
/// One request per connection (`Connection: close`), matching the Forge OS
/// device server's minimal HTTP dialect.
pub fn raw_request_bytes(
    host: String,
    port: u16,
    token: String,
    method: String,
    path: String,
    extra_headers: &[(&str, String)],
    body: &[u8],
    timeout_secs: u64,
) -> Result<(u16, Vec<u8>), String> {
    let mut stream = connect(&host, port, timeout_secs)?;

    let mut req = Vec::new();
    req.extend_from_slice(format!("{} {} HTTP/1.1\r\n", method, path).as_bytes());
    req.extend_from_slice(format!("Host: {}:{}\r\n", host, port).as_bytes());
    if !token.is_empty() {
        req.extend_from_slice(format!("Authorization: Bearer {}\r\n", token).as_bytes());
    }
    for (k, v) in extra_headers {
        req.extend_from_slice(format!("{}: {}\r\n", k, v).as_bytes());
    }
    req.extend_from_slice(format!("Content-Length: {}\r\n", body.len()).as_bytes());
    req.extend_from_slice(b"Connection: close\r\n\r\n");
    req.extend_from_slice(body);

    stream.write_all(&req).map_err(|e| format!("write failed: {}", e))?;
    read_response(stream)
}

/// JSON-friendly request command used by the frontend (kept for compatibility).
#[tauri::command]
pub fn forge_request(
    host: String,
    port: u16,
    token: String,
    method: String,
    path: String,
    body: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<ForgeResponse, String> {
    let timeout = timeout_secs.unwrap_or(30);
    let payload = body.unwrap_or_default();
    let headers: Vec<(&str, String)> = vec![("Content-Type", "application/json".to_string())];
    let (status, bytes) =
        raw_request_bytes(host, port, token, method, path, &headers, payload.as_bytes(), timeout)?;
    Ok(ForgeResponse {
        status,
        body: String::from_utf8_lossy(&bytes).to_string(),
    })
}
