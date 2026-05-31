const express = require("express");
const { z } = require("zod");
const { supabaseAnon } = require("../config/supabase");

const router = express.Router();

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  metadata: z.record(z.string(), z.any()).optional(),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post("/signup", async (req, res, next) => {
  try {
    const body = signUpSchema.parse(req.body);

    const { data, error } = await supabaseAnon.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        data: body.metadata || {},
      },
    });

    if (error) {
      error.statusCode = error.status || 400;
      error.expose = true;
      throw error;
    }

    return res.status(201).json({
      user: data.user,
      session: data.session, // Session is returned if email confirmation is disabled or if it's auto-confirmed
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request",
        details: err.flatten(),
      });
    }
    return next(err);
  }
});

router.post("/signin", async (req, res, next) => {
  try {
    const body = signInSchema.parse(req.body);

    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error) {
      error.statusCode = error.status || 401;
      error.expose = true;
      throw error;
    }

    return res.status(200).json({
      user: data.user,
      session: data.session,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request",
        details: err.flatten(),
      });
    }
    return next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const { error } = await supabaseAnon.auth.signOut();

    if (error) {
      error.statusCode = error.status || 500;
      error.expose = true;
      throw error;
    }

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
