import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, getTableName, is } from "drizzle-orm";
import { MySqlTable, int, mysqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import {
  childProfiles, classEnrollments, materialAssignments, readerClasses, readingExercises,
  readingMaterials, readingSessions, schools,
} from "../drizzle/schema";
import { MissingTenantScopeError, UnknownTenantTableError, scopeForUser, scopedDb, tenantDb } from "./tenantScope";

// Building SQL never opens a connection, so these run without a database.
const raw = drizzle("mysql://unused:unused@127.0.0.1:3306/unused");
const db = tenantDb(raw, { schoolId: 7 });
const sqlOf = (builder: { toSQL: () => { sql: string; params: unknown[] } }) => builder.toSQL();
/** Counts how many times a table's schoolId is constrained anywhere in the statement. */
const constraints = (sql: string, table: string) => sql.split(`\`${table}\`.\`schoolId\` = ?`).length - 1;

describe("tenant seam — reads", () => {
  it("constrains a select that carries no predicate of its own", () => {
    const { sql, params } = sqlOf(db.select().from(readingSessions));
    expect(constraints(sql, "readingSessions")).toBe(1);
    expect(params).toContain(7);
  });

  it("keeps the tenant predicate when the caller adds its own", () => {
    const { sql, params } = sqlOf(db.select().from(readingSessions).where(eq(readingSessions.childProfileId, 42)));
    expect(constraints(sql, "readingSessions")).toBe(1);
    expect(sql).toContain("`readingSessions`.`childProfileId` = ?");
    expect(sql).toMatch(/and/i);
    expect(params).toEqual(expect.arrayContaining([7, 42]));
  });

  it("constrains the joined table too, not only the root (two-table join)", () => {
    // Mirrors the roster join in readerDb: enrolments joined to their class.
    const { sql } = sqlOf(
      db.select({ teacherUserId: readerClasses.teacherUserId })
        .from(classEnrollments)
        .innerJoin(readerClasses, eq(classEnrollments.classId, readerClasses.id))
        .where(eq(classEnrollments.childProfileId, 1)),
    );
    expect(constraints(sql, "classEnrollments")).toBe(1);
    expect(constraints(sql, "readerClasses")).toBe(1);
    // The joined table is constrained inside the ON clause, before the WHERE.
    expect(sql.indexOf("`readerClasses`.`schoolId`")).toBeLessThan(sql.indexOf("where"));
  });

  it("constrains every joined table in a four-table join, including a left join", () => {
    // Mirrors listAssignedMaterialsForChild.
    const { sql } = sqlOf(
      db.select({ id: readingMaterials.id })
        .from(childProfiles)
        .innerJoin(classEnrollments, eq(childProfiles.id, classEnrollments.childProfileId))
        .innerJoin(materialAssignments, eq(classEnrollments.classId, materialAssignments.classId))
        .innerJoin(readingMaterials, eq(materialAssignments.materialId, readingMaterials.id))
        .leftJoin(readingExercises, eq(readingMaterials.id, readingExercises.materialId)),
    );
    for (const table of ["childProfiles", "classEnrollments", "materialAssignments", "readingMaterials", "readingExercises"]) {
      expect(constraints(sql, table), `${table} must be constrained`).toBe(1);
    }
  });

  it("matches the school row by identity rather than membership", () => {
    const { sql } = sqlOf(db.select().from(schools));
    expect(sql).toContain("`schools`.`id` = ?");
  });
});

describe("tenant seam — writes", () => {
  it("injects the school on insert", () => {
    const { sql, params } = sqlOf(db.insert(readerClasses).values({ teacherUserId: 1, name: "Owls", joinCode: "X" }));
    expect(sql).toContain("`schoolId`");
    expect(params).toContain(7);
  });

  it("refuses a row that names a different school", () => {
    // The type already forbids naming schoolId — TenantInsertValues omits it — so this cast is
    // the point of the test: a caller who defeats the type still cannot defeat the runtime.
    const crossSchool = { schoolId: 9, teacherUserId: 1, name: "Owls", joinCode: "X" } as unknown as Parameters<ReturnType<typeof db.insert<typeof readerClasses>>["values"]>[0];
    expect(() => db.insert(readerClasses).values(crossSchool)).toThrow(MissingTenantScopeError);
  });

  it("constrains update and delete", () => {
    expect(constraints(sqlOf(db.update(readingMaterials).set({ title: "t" })).sql, "readingMaterials")).toBe(1);
    expect(constraints(sqlOf(db.delete(materialAssignments).where(eq(materialAssignments.materialId, 3))).sql, "materialAssignments")).toBe(1);
  });

  it("hands the transaction callback a scoped handle, not a bare one", async () => {
    // Stub the raw transaction so no connection is needed; it yields the real Drizzle handle,
    // which is precisely the bare handle the seam must not leak to the callback.
    const stub = { transaction: (callback: (tx: unknown) => unknown) => callback(raw) };
    const scoped = tenantDb(stub as never, { schoolId: 7 });
    let insideSql = "";
    let detailsSql = "";
    await scoped.transaction(async tx => {
      insideSql = sqlOf(tx.insert(readingMaterials).values({ teacherUserId: 1, title: "T", readingLevel: "L", sourceText: "s" })).sql;
      detailsSql = sqlOf(tx.select().from(readingMaterials).where(eq(readingMaterials.id, 1))).sql;
    });
    expect(insideSql).toContain("`schoolId`");
    expect(constraints(detailsSql, "readingMaterials")).toBe(1);
  });
});

describe("tenant seam — refusals", () => {
  it("refuses a scope with no school", async () => {
    await expect(scopedDb(null)).rejects.toBeInstanceOf(MissingTenantScopeError);
    expect(() => scopeForUser({ schoolId: null })).toThrow(MissingTenantScopeError);
    expect(scopeForUser({ schoolId: 7 })).toEqual({ schoolId: 7 });
  });

  it("refuses a table that has not declared its tenancy", () => {
    const undeclared = {} as never;
    expect(() => db.select().from(undeclared)).toThrow(UnknownTenantTableError);
  });
});


describe("every table in the schema declares whether it is tenant-scoped", () => {
  const tables = Object.values(schema).filter(value => is(value, MySqlTable)) as MySqlTable[];

  it("can be read through the seam, table by table", () => {
    // readingWords was added to the schema and not to TENANT_TABLES. Insert does not consult
    // the registry, so writes worked and the table was simply unreadable: every select,
    // update and delete through the seam threw. Walking the schema is what makes this a
    // guard rather than a list someone has to remember to update.
    expect(tables.length).toBeGreaterThan(20);
    const unreadable = tables.filter(table => {
      try { db.select().from(table); return false; } catch { return true; }
    }).map(table => getTableName(table));
    expect(unreadable).toEqual([]);
  });

  it("names the offending table when one really is unregistered", () => {
    // The guard reported every table as "unknown", so it could say something was wrong but
    // not what — which is most of the value of the message.
    const stray = mysqlTable("strayTable", { id: int("id").primaryKey() });
    expect(() => db.select().from(stray)).toThrowError(UnknownTenantTableError);
    expect(() => db.select().from(stray)).toThrowError(/strayTable/);
  });
});
