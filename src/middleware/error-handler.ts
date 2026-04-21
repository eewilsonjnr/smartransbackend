import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

import { AppError } from "../common/app-error";

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details,
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A record with this unique value already exists.",
        details: error.meta,
      });
    }

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Requested record was not found.",
      });
    }
  }

  console.error(error);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
