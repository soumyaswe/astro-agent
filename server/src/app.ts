import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRoutes } from "./routes/auth.route";
import { chatHandler } from "./routes/chat.route";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(cors({
  origin: 'http://localhost:5174', // Must match the exact URL of the React app
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Routes
app.use("/auth", authRoutes);
app.post("/api/chat", chatHandler);   // SSE streaming endpoint

app.use(errorHandler);