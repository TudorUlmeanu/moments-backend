import express from "express";
import cors from "cors";
import { cfg } from "./config";
import publishRouter from "./routes/publish";

const app = express();
app.use(cors({ origin: [/localhost:\d+$/] })); // tighten for prod
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/publish", publishRouter);

app.listen(cfg.port, () => {
  console.log(`publisher listening on :${cfg.port}`);
});
