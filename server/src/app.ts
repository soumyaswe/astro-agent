import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { authRoutes } from "./routes/auth.route";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", authRoutes);

app.use(errorHandler);