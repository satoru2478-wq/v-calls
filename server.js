import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import path from 'path';

const PORT = process.env.PORT || 3000;

// Serve HTML/CSS/JS files
const server = createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = "." + filePath;

    const ext = String(path.extname(filePath)).toLowerCase();
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const type = mime[ext] || 'application/octet-stream';

    if (existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': type });
        res.end(readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    ws.on("error", console.error);
    ws.on("message", (msg) => {
        // Broadcast to all clients
        wss.clients.forEach((c) => {
            if (c !== ws && c.readyState === 1) c.send(msg.toString());
        });
    });
});

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
