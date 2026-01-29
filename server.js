import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import path from 'path';

const PORT = process.env.PORT || 3000;

// 1. Create HTTP Server to serve HTML, CSS, JS
const server = createServer((req, res) => {
    // Default to index.html
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = "." + filePath;

    // Map extension to MIME type
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    // Read and serve file
    if (existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end('404 Not Found');
    }
});

// 2. Attach WebSocket to the same HTTP server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    ws.on("message", (data) => {
        // Broadcast to others
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === 1) {
                client.send(data.toString());
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
