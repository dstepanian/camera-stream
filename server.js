import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { networkInterfaces } from 'os';

async function startServer() {
    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer);

    // Integrate Vite for development
    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom'
    });

    app.use(vite.middlewares);

    io.on('connection', (socket) => {
        console.log('New client connected:', socket.id);

        // When a broadcaster joins
        socket.on('broadcaster', () => {
            socket.broadcast.emit('broadcaster');
        });

        // When a viewer wants to watch
        socket.on('watcher', () => {
            socket.broadcast.emit('watcher', socket.id);
        });

        // Signaling data (offer, answer, candidate)
        socket.on('offer', (id, message) => {
            socket.to(id).emit('offer', socket.id, message);
        });

        socket.on('answer', (id, message) => {
            socket.to(id).emit('answer', socket.id, message);
        });

        socket.on('candidate', (id, message) => {
            socket.to(id).emit('candidate', socket.id, message);
        });

        socket.on('disconnect', () => {
            socket.broadcast.emit('disconnectPeer', socket.id);
        });
    });

    // Serve the index.html via Vite for the root
    app.use(async (req, res, next) => {
        const url = req.originalUrl;
        try {
            let template = await vite.transformIndexHtml(url, `
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="UTF-8" />
                <link rel="icon" type="image/svg+xml" href="/vite.svg" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>StreamLine</title>
                <link rel="stylesheet" href="/style.css" />
                <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
              </head>
              <body>
                <div id="app"></div>
                <script type="module" src="/main.js"></script>
              </body>
            </html>
            `);
            res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } catch (e) {
            vite.ssrFixStacktrace(e);
            next(e);
        }
    });

    const ip = getLocalIpAddress();
    httpServer.listen(3000, '0.0.0.0', () => {
        console.log(`Server running at http://localhost:3000`);
        console.log(`Network access: http://${ip}:3000`);
    });
}

function getLocalIpAddress() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

startServer();
