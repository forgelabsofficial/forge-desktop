use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(serde::Serialize)]
pub struct ForgeResponse {
    pub status: u16,
    pub body: String,
}

/// Speaks the minimal HTTP/1.1 dialect of Forge OS's ForgeHttpServer:
/// one request per connection, `Connection: close`, no chunked encoding.
/// Raw TCP is used (rather than reqwest) because the device server omits
/// headers like Date/Server that strict HTTP clients can reject.
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
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(30));

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(
        &addr
            .parse::<std::net::SocketAddr>()
            .or_else(|_| {
                // Resolve hostname to SocketAddr
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

    let payload = body.unwrap_or_default();
    let mut req = String::new();
    req.push_str(&format!("{} {} HTTP/1.1\r\n", method, path));
    req.push_str(&format!("Host: {}:{}\r\n", host, port));
    req.push_str("Content-Type: application/json\r\n");
    req.push_str(&format!("Content-Length: {}\r\n", payload.as_bytes().len()));
    if !token.is_empty() {
        req.push_str(&format!("Authorization: Bearer {}\r\n", token));
    }
    req.push_str("Connection: close\r\n\r\n");
    req.push_str(&payload);

    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write failed: {}", e))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("read failed: {}", e))?;

    let text = String::from_utf8_lossy(&raw).to_string();
    let split = text
        .find("\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response".to_string())?;
    let head = &text[..split];
    let resp_body = text[split + 4..].to_string();

    let status: u16 = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "missing status line".to_string())?;

    Ok(ForgeResponse {
        status,
        body: resp_body,
    })
}
