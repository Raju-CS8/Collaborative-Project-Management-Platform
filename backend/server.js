
const express = require("express");
const cors = require("cors");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
}));
app.use(express.json({ limit: "1mb" }));

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
  },
});

app.set("io", io);

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));

    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  socket.on("project:join", async (projectId) => {
    if (typeof projectId !== "string") return;

    try {
      const db = require("./db");

      if (socket.user.role === "admin") {
        const exists = await db.query(
          "SELECT 1 FROM projects WHERE id = $1",
          [projectId]
        );
        if (exists.rowCount) socket.join(`project:${projectId}`);
        return;
      }

      const access = await db.query(
        `SELECT 1 FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id
         WHERE p.id = $1
           AND (p.created_by = $2 OR pm.user_id = $2)
         LIMIT 1`,
        [projectId, socket.user.id]
      );

      if (access.rowCount) socket.join(`project:${projectId}`);
    } catch (error) {
      console.error("Project room authorization failed:", error.message);
    }
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const db = require("./db");
    await db.query("SELECT 1");
    res.json({ status: "ok", service: "neostats-backend", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "disconnected" });
  }
});

app.use("/api", require("./routes"));

app.use((err, req, res, next) => {
  console.error(err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

server.listen(PORT, () => {
  console.log(`NeoStats API running at http://localhost:${PORT}`);
});
