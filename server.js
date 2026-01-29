import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;

// Serve the single index.html file for all routes
const server = createServer((req, res) => {
    // If asking for favicon, ignore
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }

    // Always serve index.html
    if (existsSync('index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync('index.html'));
    } else {
        res.writeHead(404);
        res.end("Error: index.html not found.");
    }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    ws.on("message", (data) => {
        // Broadcast to everyone else
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(data.toString());
            }
        });
    });
});

server.listen(PORT, () => console.log(`\n>>> V CALLS RUNNING ON PORT ${PORT} <<<\n`));
