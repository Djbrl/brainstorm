import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, WebSocket } from "ws";
import type { WsMessage } from "../types";
import { isLocalHost, isLocalOrigin } from "./local";
import { liveTokenOk } from "./secrets";

/** A browser always says which page opens a socket (Origin). Such a page needs the live token, which only Rundown's own
 * page can read: another app on another localhost port can't listen in. Scripts and tools (no Origin) are local already. */
export function liveClientOk(host: string | undefined, origin: string | undefined, url: string | undefined): boolean {
  if (!isLocalHost(host)) return false;
  if (!origin) return true;
  let token: string | null = null;
  try { token = new URL(url ?? "", "http://localhost").searchParams.get("t"); } catch { /* no token */ }
  return isLocalOrigin(origin) && liveTokenOk(token);
}

/** Push-only websocket at /ws. Anyone can call broadcast(). Only Rundown's own page (or a local tool) may connect. */
@WebSocketGateway({
  path: "/ws",
  verifyClient: ({ origin, req }: { origin?: string; req: { headers: { host?: string }; url?: string } }) => liveClientOk(req.headers.host, origin, req.url),
})
export class EventsGateway {
  @WebSocketServer() server: Server;
  broadcast(msg: WsMessage) {
    if (!this.server) return;
    const data = JSON.stringify(msg);
    this.server.clients.forEach((c: WebSocket) => { if (c.readyState === 1) c.send(data); });
  }
}
