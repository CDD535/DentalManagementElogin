import path from "path";
import fs from "fs";
import { defineConfig } from "prisma/config";

function loadEnvFile(): string | undefined {
  const candidates = [
    path.resolve(__dirname, "prisma", ".env"),
    path.resolve(process.cwd(), "prisma", ".env"),
    path.resolve(__dirname, ".env"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key === "DATABASE_URL") return val;
      }
    } catch {}
  }
  return process.env.DATABASE_URL;
}

const url = loadEnvFile();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: url!,
  },
});
