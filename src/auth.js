import crypto from "node:crypto";

export function enforceDashboardAuth(request, response) {
  const password = process.env.DASHBOARD_PASSWORD;

  if (!password) {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("DASHBOARD_PASSWORD is required before exposing live trading dashboard.");
    return false;
  }

  const header = request.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return deny(response);

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return deny(response);
  }
  const separator = decoded.indexOf(":");
  const candidate = separator >= 0 ? decoded.slice(separator + 1) : "";
  if (!constantTimeEqual(candidate, password)) return deny(response);
  return true;
}

// Codex: a loopback reverse proxy must not bypass authentication.
export function enforceRequestBoundary(request, response) {
  const port = process.env.PORT || "3000";
  const allowed = (process.env.DASHBOARD_ALLOWED_HOSTS || `localhost:${port},127.0.0.1:${port},[::1]:${port}`)
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const host = String(request.headers.host || "").toLowerCase();
  let valid = allowed.includes(host);
  const origin = request.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      valid &&= ["http:", "https:"].includes(url.protocol) && url.host.toLowerCase() === host;
    } catch {
      valid = false;
    }
  }
  if (request.headers["sec-fetch-site"] === "cross-site") valid = false;
  if (valid) return true;
  response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Untrusted dashboard host or origin.");
  return false;
}

export function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function deny(response) {
  response.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Toss Invest"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end("Authentication required.");
  return false;
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
