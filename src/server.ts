import "dotenv/config";
import express from "express";
import cors from "cors";
import publishRouter from "./routes/publish";

const app = express();

const allowed = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://main.d35yvrqjty7o2b.amplifyapp.com/",
];
const localhostRegex = /^http:\/\/localhost:\d+$/;

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowed.includes(origin) || localhostRegex.test(origin))
        return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-requested-with"],
    credentials: true,
    maxAge: 86400,
  })
);

app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", publishRouter);

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`API on :${port}`));
