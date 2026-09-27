import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, WebSocket } from "ws";
import type { WsMessage } from "../types";

/** Push-only websocket at /ws. Anyone can call broadcast(). */
@WebSocketGateway({ path: "/ws" })
export class EventsGateway {
  @WebSocketServer() server: Server;
  broadcast(msg: WsMessage) {
    if (!this.server) return;
    const data = JSON.stringify(msg);
    this.server.clients.forEach((c: WebSocket) => { if (c.readyState === 1) c.send(data); });
  }
}
