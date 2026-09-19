/**
 * The tenant seam.
 *
 * The school is the data controller, so a query over school data must name its school. This
 * module is the only place that turns a raw Drizzle handle into one that can read or write
 * tenant-scoped tables, and the raw handle is not reachable through what it returns.
 *
 * What the guard covers
 * ---------------------
 *  - **The root table.** `select().from(t)` gets `t.schoolId = :scope` applied at `.from()`,
 *    before the caller sees the builder, so a query with no `.where()` of its own is still
 *    constrained. A caller's own `.where(p)` is AND-ed with the tenant predicate rather than
 *    replacing it.
 *  - **Every joined tenant table.** `innerJoin(t2, on)` and `leftJoin(t2, on)` AND
 *    `t2.schoolId = :scope` into the ON clause. ANDing the root table alone would not stop a
 *    permissive join predicate from surfacing another school's rows through the joined table,
 *    and this data layer joins on 20 call sites. On a left join this narrows the joined side
 *    without dropping root rows, which is the intended reading of "this school's rows only".
 *  - **Writes.** `insert()` injects `schoolId` (and rejects a row that names a different one),
 *    so a write cannot omit or contradict its scope. `update()` and `delete()` get the tenant
 *    predicate applied at construction and AND-ed with any caller predicate.
 *  - **Transactions.** `transaction(cb)` hands the callback another scoped handle, never the
 *    bare Drizzle transaction, so a multi-table write inside a transaction stays scoped.
 *
 * What it does not cover
 * ----------------------
 *  - Raw SQL. Nothing here parses `sql` template fragments; a hand-written predicate is the
 *    author's responsibility.
 *  - `unscopedDb()`. A deliberate, greppable escape hatch for the few operations that precede
 *    or transcend a school. Every call site must justify itself in review.
 *  - A table absent from TENANT_TABLES. Unknown tables throw rather than pass unfiltered, so
 *    adding a table forces a tenancy decision instead of silently inheriting none.
 */
import { and, eq, getTableName, type SQL } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import {
  childProfiles, classEnrollments, educatorApprovedIrishVariants, familyLinks,
  homePracticeChecklists, learnerReadingSettings, materialAssignments, parentReminders,
  provisionalMatchReviews, quizAttempts, readerClasses, readingExercises,
  readingMaterialDetails, readingMaterials, readingSessions, schoolBranding, schools,
  readingWords, sessionComments, teacherTermPresets, users, weeklyReadingGoals,
} from "../drizzle/schema";
import { getDb } from "./db";

export type TenantScope = { readonly schoolId: number };

/** Raised when an account with no school membership reaches a tenant-scoped operation. */
export class MissingTenantScopeError extends Error {
  constructor(message = "This account is not a member of a school, so it cannot read or write school data.") {
    super(message);
    this.name = "MissingTenantScopeError";
  }
}

/** Raised when a table is used through the seam without having declared its tenancy. */
export class UnknownTenantTableError extends Error {
  constructor(name: string) {
    super(`Table "${name}" has not declared whether it is tenant-scoped. Add it to TENANT_TABLES.`);
    this.name = "UnknownTenantTableError";
  }
}

/** Every tenant-scoped table, keyed by the column that carries its school. */
const TENANT_TABLES = new Map<unknown, (scope: TenantScope) => SQL>([
  [childProfiles, s => eq(childProfiles.schoolId, s.schoolId)],
  [classEnrollments, s => eq(classEnrollments.schoolId, s.schoolId)],
  [educatorApprovedIrishVariants, s => eq(educatorApprovedIrishVariants.schoolId, s.schoolId)],
  [familyLinks, s => eq(familyLinks.schoolId, s.schoolId)],
  [homePracticeChecklists, s => eq(homePracticeChecklists.schoolId, s.schoolId)],
  [learnerReadingSettings, s => eq(learnerReadingSettings.schoolId, s.schoolId)],
  [materialAssignments, s => eq(materialAssignments.schoolId, s.schoolId)],
  [parentReminders, s => eq(parentReminders.schoolId, s.schoolId)],
  [provisionalMatchReviews, s => eq(provisionalMatchReviews.schoolId, s.schoolId)],
  [quizAttempts, s => eq(quizAttempts.schoolId, s.schoolId)],
  [readerClasses, s => eq(readerClasses.schoolId, s.schoolId)],
  [readingExercises, s => eq(readingExercises.schoolId, s.schoolId)],
  [readingMaterialDetails, s => eq(readingMaterialDetails.schoolId, s.schoolId)],
  [readingMaterials, s => eq(readingMaterials.schoolId, s.schoolId)],
  [readingSessions, s => eq(readingSessions.schoolId, s.schoolId)],
  [readingWords, s => eq(readingWords.schoolId, s.schoolId)],
  [schoolBranding, s => eq(schoolBranding.schoolId, s.schoolId)],
  [sessionComments, s => eq(sessionComments.schoolId, s.schoolId)],
  [teacherTermPresets, s => eq(teacherTermPresets.schoolId, s.schoolId)],
  [users, s => eq(users.schoolId, s.schoolId)],
  [weeklyReadingGoals, s => eq(weeklyReadingGoals.schoolId, s.schoolId)],
  // The school row itself is the tenant, so it is matched by identity rather than membership.
  [schools, s => eq(schools.id, s.schoolId)],
]);

/** Columns the seam owns. A caller may not set these itself. */
const SCOPE_COLUMN = "schoolId";

function tableName(table: unknown) {
  // Drizzle keeps the table name behind a symbol, not on `_.name`, so reading `_.name`
  // returned "unknown" for every table in the schema — leaving the guard able to say a table
  // was unregistered but not which one.
  try {
    return getTableName(table as MySqlTable);
  } catch {
    return "unknown";
  }
}

function tenantPredicate(table: unknown, scope: TenantScope): SQL {
  const build = TENANT_TABLES.get(table);
  if (!build) throw new UnknownTenantTableError(tableName(table));
  return build(scope);
}

/** Drizzle's builders mutate and return themselves, so chaining keeps the same proxy. */
function guardBuilder<T extends object>(builder: T, scope: TenantScope, rootPredicate: SQL | null): T {
  const proxy: T = new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      // Awaiting the builder must reach the real thenable.
      if (prop === "then" || prop === "catch" || prop === "finally") return value.bind(target);

      if (prop === "where") {
        return (predicate?: SQL) => {
          const combined = rootPredicate && predicate ? and(rootPredicate, predicate) : (rootPredicate ?? predicate);
          value.call(target, combined);
          return proxy;
        };
      }
      if (prop === "innerJoin" || prop === "leftJoin" || prop === "rightJoin" || prop === "fullJoin") {
        return (joined: MySqlTable, on: SQL) => {
          // The joined table is constrained in the ON clause, so a permissive join predicate
          // cannot pull in another school's rows.
          value.call(target, joined, and(on, tenantPredicate(joined, scope)));
          return proxy;
        };
      }
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
}

function scopeRow(table: unknown, scope: TenantScope, row: Record<string, unknown>) {
  const given = row[SCOPE_COLUMN];
  if (given !== undefined && given !== scope.schoolId) {
    throw new MissingTenantScopeError(`Refusing to write a ${tableName(table)} row for school ${String(given)} under scope ${scope.schoolId}.`);
  }
  return { ...row, [SCOPE_COLUMN]: scope.schoolId };
}

type RawDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type RawTransaction = Parameters<Parameters<RawDatabase["transaction"]>[0]>[0];

/**
 * A Drizzle handle that can only see and touch one school.
 *
 * The query-builder members are declared with Drizzle's own signatures so callers keep exact
 * row types; the implementation substitutes guarded builders behind that signature. Callers
 * only ever reach `.from`, `.values` and `.set` from these, which the implementation provides.
 */
/** The seam owns `schoolId`, so a caller neither supplies it nor can contradict it. */
export type TenantInsertValues<TTable extends MySqlTable> = Omit<TTable["$inferInsert"], "schoolId">;

interface TenantInsertBuilder extends Promise<unknown> {
  onDuplicateKeyUpdate(config: { set: Record<string, unknown> }): Promise<unknown>;
  toSQL(): { sql: string; params: unknown[] };
}

export type TenantDatabase = {
  readonly scope: TenantScope;
  select: RawDatabase["select"];
  insert: <TTable extends MySqlTable>(table: TTable) => {
    values(values: TenantInsertValues<TTable> | TenantInsertValues<TTable>[]): TenantInsertBuilder;
  };
  update: RawDatabase["update"];
  delete: RawDatabase["delete"];
  transaction<T>(callback: (tx: TenantDatabase) => Promise<T>): Promise<T>;
};

export function tenantDb(raw: RawDatabase | RawTransaction, scope: TenantScope): TenantDatabase {
  const handle = raw as RawDatabase;

  const select = ((...fields: unknown[]) => {
    const builder = (handle.select as (...args: unknown[]) => { from: (table: MySqlTable) => object })(...fields);
    return {
      from: (table: MySqlTable) => {
        const predicate = tenantPredicate(table, scope);
        const scoped = builder.from(table) as { where: (p: SQL) => object };
        return guardBuilder(scoped.where(predicate), scope, predicate);
      },
    };
  }) as unknown as RawDatabase["select"];

  const insert = ((table: MySqlTable) => {
    const inserter = (handle.insert as (t: MySqlTable) => { values: (rows: unknown) => object })(table);
    return {
      values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const scoped = Array.isArray(rows) ? rows.map(row => scopeRow(table, scope, row)) : scopeRow(table, scope, rows);
        return guardBuilder(inserter.values(scoped), scope, null);
      },
    };
  }) as unknown as TenantDatabase["insert"];

  const update = ((table: MySqlTable) => {
    const predicate = tenantPredicate(table, scope);
    const updater = (handle.update as (t: MySqlTable) => { set: (v: unknown) => { where: (p: SQL) => object } })(table);
    return {
      set: (values: Record<string, unknown>) => guardBuilder(updater.set(values).where(predicate), scope, predicate),
    };
  }) as unknown as RawDatabase["update"];

  const remove = ((table: MySqlTable) => {
    const predicate = tenantPredicate(table, scope);
    const deleter = (handle.delete as (t: MySqlTable) => { where: (p: SQL) => object })(table);
    return guardBuilder(deleter.where(predicate), scope, predicate);
  }) as unknown as RawDatabase["delete"];

  return {
    scope,
    select,
    insert,
    update,
    delete: remove,
    transaction<T>(callback: (tx: TenantDatabase) => Promise<T>): Promise<T> {
      return handle.transaction(tx => callback(tenantDb(tx, scope))) as Promise<T>;
    },
  };
}

async function requireRawDb() {
  const db = await getDb();
  if (!db) throw new Error("Reader Leader data is temporarily unavailable.");
  return db;
}

/** The only way to query school data. A scope without a school is refused here, not downstream. */
export async function scopedDb(scope: TenantScope | null | undefined): Promise<TenantDatabase> {
  if (!scope || scope.schoolId === null || scope.schoolId === undefined) throw new MissingTenantScopeError();
  return tenantDb(await requireRawDb(), scope);
}

/**
 * Escape hatch for operations that precede or transcend a school. Every call site is expected
 * to be justified in review; there should be very few. Currently: the OAuth `users` upsert and
 * sign-in lookup, which run before a school is known, and demo provisioning, which creates the
 * school-less scaffolding a scope would be resolved from.
 */
export async function unscopedDb() {
  return requireRawDb();
}

/** Resolves the scope carried by an authenticated account, refusing a break-glass support user. */
export function scopeForUser(user: { schoolId: number | null }): TenantScope {
  if (user.schoolId === null) throw new MissingTenantScopeError();
  return { schoolId: user.schoolId };
}
