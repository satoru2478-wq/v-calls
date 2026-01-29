import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import path from 'path';

const PORT = process.env.PORT || 3000;

const server = createServer((req, res) => {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    
    const filePath = "." + url;
    const ext = path.extname(filePath).toLowerCase();
    
    const mime = { 
        '.html': 'text/html', 
        '.js': 'text/javascript', 
        '.css': 'text/css',
        '.json': 'application/json'
    };

    if (existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
        wss.clients.forEach((c) => {
            if (c !== ws && c.readyState === 1) c.send(msg.toString());
        });
    });
});

server.listen(PORT, () => console.log(`Server Ready on ${PORT}`));
