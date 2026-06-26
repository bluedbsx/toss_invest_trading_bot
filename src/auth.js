import crypto from "node:crypto";

export function enforceDashboardAuth(request, response) {
  const password = process.env.DASHBOARD_PASSWORD;
  const authRequired = isAuthRequired(request);
  if (!authRequired) return true;

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

function isAuthRequired(request) {
  if (process.env.DASHBOARD_AUTH_DISABLED === "true") return false;
  if (process.env.DASHBOARD_PASSWORD) return true;
  if (isLocalRequest(request)) return false;
  return true;
}

function isLocalRequest(request) {
  const remote = request.socket?.remoteAddress ?? "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
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
