/** Liveness probe for the web app itself. Upstream checks live on /status. */
export function GET() {
  return Response.json({ status: "ok", service: "arthasense-web" });
}
