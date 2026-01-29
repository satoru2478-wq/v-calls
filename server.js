import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    // Broadcast to everyone else (filtering happens on client side)
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(msg.toString());
      }
    });
  });
});

console.log("V CALLS Server Running");
