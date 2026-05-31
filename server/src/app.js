const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const { env } = require("./config/env");
const authRoutes = require("./routes/auth.route");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", authRoutes);

app.use(errorHandler);

module.exports = app;