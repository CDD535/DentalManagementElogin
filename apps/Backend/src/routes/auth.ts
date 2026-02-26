import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { storage } from "../storage";
import { UserUncheckedCreateInputObjectSchema } from "@repo/db/usedSchemas";
import { z } from "zod";

type SelectUser = z.infer<typeof UserUncheckedCreateInputObjectSchema>;

const JWT_SECRET = process.env.JWT_SECRET || "your-jwt-secret";
const JWT_EXPIRATION = "24h";

async function hashPassword(password: string) {
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  return hashedPassword;
}

async function comparePasswords(supplied: string, stored: string) {
  const isMatch = await bcrypt.compare(supplied, stored);
  return isMatch;
}

function generateToken(user: SelectUser) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: JWT_EXPIRATION,
  });
}

const router = express.Router();

router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    return res.status(403).json({ error: "Public registration is disabled. Please contact your administrator." });
  }
);

router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
      const user = await storage.getUserByUsername(req.body.username);

      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const isPasswordMatch = await comparePasswords(
        req.body.password,
        user.password
      );

      if (!isPasswordMatch) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const token = generateToken(user);
      const { password, ...rest } = user;
      const safeUser = { ...rest, role: rest.role ?? "USER" };
      return res.status(200).json({ user: safeUser, token });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/logout", (req: Request, res: Response) => {
  res.status(200).send("Logged out successfully");
});

export default router;
