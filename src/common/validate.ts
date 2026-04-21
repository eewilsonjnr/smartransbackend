import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

import { AppError } from "./app-error";

export const validateBody =
  <T>(schema: ZodSchema<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return next(new AppError(400, "Invalid request body", result.error.flatten()));
    }

    req.body = result.data;
    return next();
  };
