import type { Request } from "express";

import { AppError } from "./app-error";

export const requiredParam = (req: Request, name: string) => {
  const value = req.params[name];

  if (!value || Array.isArray(value)) {
    throw new AppError(400, `Missing route parameter: ${name}`);
  }

  return value;
};
