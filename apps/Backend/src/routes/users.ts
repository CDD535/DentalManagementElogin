import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { UserUncheckedCreateInputObjectSchema } from "@repo/db/usedSchemas";
import bcrypt from "bcrypt";


const router = Router();

type SelectUser = z.infer<typeof UserUncheckedCreateInputObjectSchema>;

const userCreateSchema = UserUncheckedCreateInputObjectSchema;
const userUpdateSchema = (UserUncheckedCreateInputObjectSchema as unknown as z.ZodObject<any>).partial();


router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).send("Unauthorized UserId");

    const user = await storage.getUser(userId);
    if (!user) return res.status(404).send("User not found");

    const { password, ...rest } = user;
    res.json({ ...rest, role: rest.role ?? "USER" });
  } catch (error) {
    console.error(error);
    res.status(500).send("Failed to fetch user");
  }
});

router.get("/list", async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.user?.id) return res.status(401).send("Unauthorized");

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const users = await storage.getUsers(limit, offset);
    const safe = users.map((u) => {
      const { password: _p, ...rest } = u;
      return { ...rest, role: rest.role ?? "USER" };
    });
    res.json(safe);
  } catch (error) {
    console.error(error);
    res.status(500).send("Failed to fetch users");
  }
});

router.get("/:id", async (req: Request, res: Response): Promise<any> => {
  try {
    const idParam = req.params.id;
    if (!idParam) return res.status(400).send("User ID is required");

    const id = parseInt(idParam);
    if (isNaN(id)) return res.status(400).send("Invalid user ID");

    const user = await storage.getUser(id);
    if (!user) return res.status(404).send("User not found");

    const { password, ...rest } = user;
    res.json({ ...rest, role: rest.role ?? "USER" });
  } catch (error) {
    console.error(error);
    res.status(500).send("Failed to fetch user");
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const input = userCreateSchema.parse(req.body);
    const existing = await storage.getUserByUsername(input.username);
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }
    const hashed = await hashPassword(input.password);
    const newUser = await storage.createUser({ ...input, password: hashed });
    const { password: _p, ...rest } = newUser;
    res.status(201).json({ ...rest, role: rest.role ?? "USER" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid user data", details: err });
  }
});

async function hashPassword(password: string) {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

router.put("/:id", async (req: Request, res: Response):Promise<any> => {
  try {
    const idParam = req.params.id;
    if (!idParam) return res.status(400).send("User ID is required");

    const id = parseInt(idParam);
    if (isNaN(id)) return res.status(400).send("Invalid user ID");


    const updates = userUpdateSchema.parse(req.body);

    if (updates.password && updates.password.trim() !== "") {
      updates.password = await hashPassword(updates.password);
    } else {
      delete updates.password;
    }

    const updatedUser = await storage.updateUser(id, updates);
    if (!updatedUser) return res.status(404).send("User not found");

    const { password, ...rest } = updatedUser;
    res.json({ ...rest, role: rest.role ?? "USER" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid update data", details: err });
  }
});

router.delete("/:id", async (req: Request, res: Response): Promise<any> => {
  try {
    const idParam = req.params.id;
    if (!idParam) return res.status(400).send("User ID is required");

    const id = parseInt(idParam);
    if (isNaN(id)) return res.status(400).send("Invalid user ID");

    if (req.user?.id === id) {
      return res.status(403).json({ error: "Cannot delete your own account" });
    }

    const success = await storage.deleteUser(id);
    if (!success) return res.status(404).send("User not found");

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).send("Failed to delete user");
  }
});

export default router;
