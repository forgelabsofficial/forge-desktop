use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(serde::Serialize)]
pub struct ForgeResponse {
    pub status: u16,
    pub body: String,
}

fn connect(host: &str, port: u16, timeout_secs: u64) -> Result<TcpStream, String> {
    let timeout = Duration::from_secs(timeout_secs);
    let addr = format!("{}:{}", host, port);
    let stream = TcpStream::connect(
        &addr
            .parse::<std::net::SocketAddr>()
            .or_else(|_| {
                use std::net::ToSocketAddrs;
                addr.to_socket_addrs()
                    .map_err(|e| e.to_string())?
                    .next()
                    .ok_or_else(|| format!("no address for {}", addr))
            })
            .map_err(|e| format!("invalid address {}: {}", addr, e))?,
    )
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