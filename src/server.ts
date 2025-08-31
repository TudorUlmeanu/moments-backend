// server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import publishRouter from "./routes/publish";

const app = express();

const openCors = cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["*"],
  exposedHeaders: ["*"],
  maxAge: 86400, // cache preflight for a day
  // credentials MUST be false if origin is "*"
  credentials: false,
});

app.use(openCors);
app.options("*", openCors);

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", publishRouter);

// basic error handler
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`API on :${port}`));
