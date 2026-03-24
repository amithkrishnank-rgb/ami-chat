const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── CONFIG — change passwords here ──
const USERS = {
  ami:  { password: process.env.AMI_PASSWORD  || 'ami123',  name: 'Ami' },
  her:  { password: process.env.HER_PASSWORD  || 'her123',  name: process.env.HER_NAME || 'My Love' }
};

// In-memory message store (persists while server runs)
// For permanent storage, messages survive server restarts via the array below
let messages = [];
const MAX_MESSAGES = 500; // keep last 500 messages

// Connected clients: { ws, user }
const clients = new Set();

// ── REST: Login ──
app.post('/api/login', (req, res) => {
  const { user, password } = req.body;
  if (!USERS[user]) return res.status(401).json({ error: 'Unknown user' });
  if (USERS[user].password !== password) return res.status(401).json({ error: 'Wrong password' });
  res.json({ ok: true, name: USERS[user].name, herName: USERS.her.name });
});

// ── REST: Get message history ──
app.get('/api/messages', (req, res) => {
  const { user, password } = req.query;
  if (!USERS[user] || USERS[user].password !== password) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(messages);
});

// ── WebSocket ──
wss.on('connection', (ws) => {
  let authed = false;
  let clientUser = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // Auth handshake
    if (data.type === 'auth') {
      const u = USERS[data.user];
      if (!u || u.password !== data.password) {
        ws.send(JSON.stringify({ type: 'auth_fail' }));
        ws.close();
        return;
      }
      authed = true;
      clientUser = data.user;
      clients.add({ ws, user: clientUser });
      ws.send(JSON.stringify({ type: 'auth_ok', history: messages }));

      // Notify other user this person is online
      broadcast({ type: 'presence', user: clientUser, online: true }, ws);
      return;
    }

    if (!authed) return;

    // Incoming message
    if (data.type === 'message') {
      const msg = {
        id: Date.now(),
        sender: clientUser,
        text: String(data.text).slice(0, 2000),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
        ts: Date.now()
      };
      messages.push(msg);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);

      // Broadcast to ALL connected clients including sender
      broadcastAll({ type: 'message', msg });
    }
  });

  ws.on('close', () => {
    // Remove from clients
    for (const c of clients) {
      if (c.ws === ws) { clients.delete(c); break; }
    }
    if (clientUser) {
      broadcast({ type: 'presence', user: clientUser, online: false }, null);
    }
  });
});

function broadcast(data, excludeWs) {
  const str = JSON.stringify(data);
  for (const c of clients) {
    if (c.ws !== excludeWs && c.ws.readyState === 1) c.ws.send(str);
  }
}

function broadcastAll(data) {
  const str = JSON.stringify(data);
  for (const c of clients) {
    if (c.ws.readyState === 1) c.ws.send(str);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
