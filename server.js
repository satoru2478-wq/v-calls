import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import path from 'path';

const PORT = process.env.PORT || 3000;

// 1. Serve Static Files (HTML/CSS/JS)
const server = createServer((req, res) => {
    // Handle URL parameters by stripping them
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    
    const filePath = "." + url;
    const ext = path.extname(filePath).toLowerCase();
    
    const mime = { 
        '.html': 'text/html', 
        '.js': 'text/javascript', 
        '.css': 'text/css' 
    };

    if (existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// 2. High-Performance WebSocket
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
        // Instant Broadcast
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(raw.toString());
            }
        });
    });
});

server.listen(PORT, () => console.log(`Engine Running on ${PORT}`));
