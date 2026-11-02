import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Who can read and write what, checked against the real database the app runs on.
 *
 * The table list is read from the declarative schema, so a new table is covered as
 * soon as it exists: by default only signed-in users may touch it. Tables whose
 * writes are restricted further are listed in RESTRICTED_WRITES.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341";
const PUBLISHABLE_KEY = process.env.VITE_SB_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY!;

/** Postgres' "insufficient privilege", returned for both missing grants and RLS. */
const DENIED = "42501";

const TABLES = [
  ...readFileSync(
    path.join(here, "../supabase/schemas/01_tables.sql"),
    "utf8",
  ).matchAll(/^create table public\.(\w+)/gm),
].map((match) => match[1]!);

const VIEWS = [
  ...readFileSync(
    path.join(here, "../supabase/schemas/03_views.sql"),
    "utf8",
  ).matchAll(/^create or replace view public\.(\w+)/gm),
].map((match) => match[1]!);

/** Views anyone may read: the login page asks whether the CRM has a first user yet. */
const PUBLIC_VIEWS = new Set(["init_state"]);

/**
 * Tables a regular (non-admin) user may read but not write. `sales` is written only
 * by triggers and the `users` edge function, so a user can't make themselves admin.
 */
const RESTRICTED_WRITES: Record<string, "admin" | "nobody"> = {
  configuration: "admin",
  products: "admin",
  sales: "nobody",
};

const PASSWORD = "access-rules-Passw0rd!";

const service = client(SERVICE_ROLE_KEY);
let anon: SupabaseClient;
let user: SupabaseClient;
let admin: SupabaseClient;
let userSalesId: number;

function client(key: string): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signedIn(
  email: string,
  administrator: boolean,
): Promise<{ client: SupabaseClient; salesId: number }> {
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  const { data: sales, error: salesError } = await service
    .from("sales")
    .update({ first_name: "Access", last_name: "Rules", administrator })
    .eq("user_id", created.user.id)
    .select("id")
    .single();
  if (salesError) throw new Error(salesError.message);

  const signed = client(PUBLISHABLE_KEY);
  const { error: signInError } = await signed.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw new Error(signInError.message);
  return { client: signed, salesId: sales.id };
}

/** One row in every table, so a leaking read has something to leak. */
async function seed(salesId: number): Promise<void> {
  const insert = async (table: string, row: object) => {
    const { data, error } = await service
      .from(table)
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(`Seeding ${table}: ${error.message}`);
    return data.id as number;
  };
  const companyId = await insert("companies", {
    name: "Access Rules Inc",
    sales_id: salesId,
  });
  const contactId = await insert("contacts", {
    first_name: "Ada",
    last_name: "Rules",
    company_id: companyId,
    sales_id: salesId,
  });
  const dealId = await insert("deals", {
    name: "Access rules deal",
    stage: "opportunity",
    company_id: companyId,
    sales_id: salesId,
  });
  const productId = await insert("products", {
    name: "Access rules product",
    sales_id: salesId,
  });
  await insert("contact_notes", { contact_id: contactId, text: "note" });
  await insert("deal_notes", { deal_id: dealId, text: "note" });
  await insert("tasks", { contact_id: contactId, text: "task" });
  await insert("tags", { name: "access-rules", color: "#eeeeee" });
  await insert("deal_products", { deal_id: dealId, product_id: productId });
  await insert("favicons_excluded_domains", { domain: "access-rules.test" });
  await service.from("configuration").upsert({ id: 1 });
}

test.beforeAll(async (_fixtures, testInfo) => {
  // No browser involved: one project is enough.
  test.skip(testInfo.project.name !== "chromium");
  const stamp = Date.now();
  const adminUser = await signedIn(`access-admin-${stamp}@example.com`, true);
  const regularUser = await signedIn(`access-user-${stamp}@example.com`, false);
  admin = adminUser.client;
  user = regularUser.client;
  userSalesId = regularUser.salesId;
  anon = client(PUBLISHABLE_KEY);
  await seed(adminUser.salesId);
});

test("the schema lists the tables and views this test checks", () => {
  expect(TABLES.length).toBeGreaterThan(5);
  expect(TABLES).toContain("sales");
  expect(VIEWS.length).toBeGreaterThan(0);
});

test.describe("anonymous visitors", () => {
  for (const table of TABLES) {
    test(`can't read ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      if (error) expect(error.code).toBe(DENIED);
      else expect(data).toEqual([]);
    });

    test(`can't insert into ${table}`, async () => {
      const { error } = await anon.from(table).insert({});
      expect(error?.code).toBe(DENIED);
    });

    test(`can't update or delete ${table}`, async () => {
      const { data: rows } = await service.from(table).select("id").limit(1);
      const id = rows?.[0]?.id;
      expect(id, `${table} needs a row in seed()`).toBeDefined();
      const updated = await anon
        .from(table)
        .update({ id })
        .eq("id", id)
        .select("id");
      if (updated.error) expect(updated.error.code).toBe(DENIED);
      else expect(updated.data).toEqual([]);
      const deleted = await anon.from(table).delete().eq("id", id).select("id");
      if (deleted.error) expect(deleted.error.code).toBe(DENIED);
      else expect(deleted.data).toEqual([]);
    });
  }

  for (const view of VIEWS.filter((name) => !PUBLIC_VIEWS.has(name))) {
    test(`can't read the ${view} view`, async () => {
      const { data, error } = await anon.from(view).select("*").limit(1);
      if (error) expect(error.code).toBe(DENIED);
      else expect(data).toEqual([]);
    });
  }

  test("can't upload attachments", async () => {
    const { error } = await anon.storage
      .from(process.env.VITE_ATTACHMENTS_BUCKET ?? "attachments")
      .upload(`access-rules-${Date.now()}.txt`, new Blob(["x"]));
    expect(error).not.toBeNull();
  });
});

test.describe("signed-in users", () => {
  for (const table of TABLES) {
    test(`can read ${table}`, async () => {
      const { data, error } = await user.from(table).select("*").limit(1);
      expect(error).toBeNull();
      expect(data?.length, `${table} needs a row in seed()`).toBe(1);
    });
  }

  for (const [table, writer] of Object.entries(RESTRICTED_WRITES)) {
    test(`a non-admin can't write ${table}`, async () => {
      const inserted = await user.from(table).insert({});
      expect(inserted.error?.code).toBe(DENIED);
      const { data: rows } = await service.from(table).select("id").limit(1);
      const id = rows![0]!.id;
      const updated = await user
        .from(table)
        .update({ id })
        .eq("id", id)
        .select("id");
      if (updated.error) expect(updated.error.code).toBe(DENIED);
      else expect(updated.data).toEqual([]);
      const deleted = await user.from(table).delete().eq("id", id).select("id");
      if (deleted.error) expect(deleted.error.code).toBe(DENIED);
      else expect(deleted.data).toEqual([]);
    });

    if (writer === "admin") {
      test(`an admin can update ${table}`, async () => {
        const { data: rows } = await service.from(table).select("id").limit(1);
        const id = rows![0]!.id;
        const { data, error } = await admin
          .from(table)
          .update({ id })
          .eq("id", id)
          .select("id");
        expect(error).toBeNull();
        expect(data).toEqual([{ id }]);
      });
    }
  }

  test("a user can't make themselves an administrator", async () => {
    await user
      .from("sales")
      .update({ administrator: true })
      .eq("id", userSalesId);
    const { data } = await service
      .from("sales")
      .select("administrator")
      .eq("id", userSalesId)
      .single();
    expect(data?.administrator).toBe(false);
  });

  test("is_admin() is false for a regular user and true for an admin", async () => {
    expect((await user.rpc("is_admin")).data).toBe(false);
    expect((await admin.rpc("is_admin")).data).toBe(true);
  });
});
