import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, WebSocket } from "ws";
import type { WsMessage } from "../types";
import { isLocalHost, isLocalOrigin } from "./local";

/** Push-only websocket at /ws. Anyone can call broadcast(). Only pages served from this machine may connect. */
@WebSocketGateway({
  path: "/ws",
  verifyClient: ({ origin, req }: { origin?: string; req: { headers: { host?: string } } }) => isLocalHost(req.headers.host) && isLocalOrigin(origin),
})
export class EventsGateway {
  @WebSocketServer() server: Server;
  broadcast(msg: WsMessage) {
    if (!this.server) return;
    const data = JSON.stringify(msg);
    this.server.clients.forEach((c: WebSocket) => { if (c.readyState === 1) c.send(data); });
  }
}
