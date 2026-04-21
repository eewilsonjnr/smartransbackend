import type { AuthorityUserRole, UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        id: string;
        fullName: string;
        email?: string | null;
        phone?: string | null;
        role: UserRole;
        organizationIds: string[];
        authorityIds: string[];
        authorityUserRole?: AuthorityUserRole;
      };
    }
  }
}

export {};
