import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const status = err.statusCode || 500;
  const message = err.expose ? err.message : "Internal server error";

  res.status(status).json({
    error: message,
  });
}
