// SPEC: docs/protocol.md#PROTO-003 controller traffic is stamped by the authenticated relay boundary.
use anyhow::{anyhow, Result};

pub const TRANSPORT_ROLE_HEADER: &str = "x-whalemaid-transport-role";
pub const CONTROLLER_ROLE: &str = "controller";
const MAX_REQUEST_HEAD: usize = 64 * 1024;
const MAX_HEADERS: usize = 128;

/// Accumulates exactly one HTTP/1 request head, removes spoofed role headers, and stamps controller traffic.
pub struct ControllerRequestMarker {
    buffered: Vec<u8>,
}

impl ControllerRequestMarker {
    pub fn new() -> Self {
        Self { buffered: Vec::new() }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Option<Vec<u8>>> {
        self.buffered.extend_from_slice(chunk);
        let Some(head_end) = self.buffered.windows(4).position(|window| window == b"\r\n\r\n").map(|index| index + 4) else {
            if self.buffered.len() > MAX_REQUEST_HEAD {
                return Err(anyhow!("controller request head exceeds limit"));
            }
            return Ok(None);
        };
        if head_end > MAX_REQUEST_HEAD {
            return Err(anyhow!("controller request head exceeds limit"));
        }

        let mut headers = [httparse::EMPTY_HEADER; MAX_HEADERS];
        let mut request = httparse::Request::new(&mut headers);
        match request.parse(&self.buffered[..head_end])? {
            httparse::Status::Complete(parsed) if parsed == head_end => {}
            _ => return Err(anyhow!("invalid controller HTTP request head")),
        }
        let method = request.method.ok_or_else(|| anyhow!("missing controller HTTP method"))?;
        let path = request.path.ok_or_else(|| anyhow!("missing controller HTTP path"))?;
        let version = request.version.ok_or_else(|| anyhow!("missing controller HTTP version"))?;

        let mut marked = Vec::with_capacity(self.buffered.len() + 64);
        marked.extend_from_slice(format!("{method} {path} HTTP/1.{version}\r\n").as_bytes());
        for header in request.headers.iter() {
            if header.name.eq_ignore_ascii_case(TRANSPORT_ROLE_HEADER) {
                continue;
            }
            marked.extend_from_slice(header.name.as_bytes());
            marked.extend_from_slice(b": ");
            marked.extend_from_slice(header.value);
            marked.extend_from_slice(b"\r\n");
        }
        marked.extend_from_slice(format!("{TRANSPORT_ROLE_HEADER}: {CONTROLLER_ROLE}\r\n\r\n").as_bytes());
        marked.extend_from_slice(&self.buffered[head_end..]);
        self.buffered.clear();
        Ok(Some(marked))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_spoofed_roles_and_stamps_exactly_one_controller_role() {
        let mut marker = ControllerRequestMarker::new();
        assert!(marker.push(b"POST /api/whalemaid/temp").unwrap().is_none());
        let marked = marker.push(
            b"orary-password HTTP/1.1\r\nHost: 127.0.0.1:3182\r\nX-WhaleMaid-Transport-Role: host\r\nx-whalemaid-transport-role: forged\r\nContent-Length: 3\r\n\r\nabc",
        ).unwrap().unwrap();
        let text = String::from_utf8(marked).unwrap();

        assert!(text.starts_with("POST /api/whalemaid/temporary-password HTTP/1.1\r\n"));
        assert_eq!(text.to_ascii_lowercase().matches(TRANSPORT_ROLE_HEADER).count(), 1);
        assert!(text.contains("x-whalemaid-transport-role: controller\r\n"));
        assert!(!text.contains("forged"));
        assert!(text.ends_with("\r\n\r\nabc"));
    }

    #[test]
    fn rejects_malformed_or_oversized_request_heads() {
        let mut malformed = ControllerRequestMarker::new();
        assert!(malformed.push(b"not-http\r\n\r\n").is_err());

        let mut oversized = ControllerRequestMarker::new();
        assert!(oversized.push(&vec![b'a'; MAX_REQUEST_HEAD + 1]).is_err());
    }
}
