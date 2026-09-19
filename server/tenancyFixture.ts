import { eq } from "drizzle-orm";
import { schools } from "../drizzle/schema";
import { getDb } from "./db";

/**
 * Integration coverage needs its own school, because every tenant-scoped row hangs off one.
 * Reuses the school when the slug already exists so a re-run does not collide.
 */
export async function ensureTestSchool(slug: string, name = `Test School ${slug}`) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const [existing] = await db.select({ id: schools.id }).from(schools).where(eq(schools.slug, slug)).limit(1);
  if (existing) return existing.id;
  await db.insert(schools).values({ name, slug });
  const [created] = await db.select({ id: schools.id }).from(schools).where(eq(schools.slug, slug)).limit(1);
  if (!created) throw new Error("Could not create the test school.");
  return created.id;
}
