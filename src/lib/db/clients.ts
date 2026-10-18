import { getDb, transact } from "./connection";
import type { Customer } from "../types";

type ClientRow = {
  id: string;
  name: string;
  email: string;
  address: string;
  created_at: string;
};

function map(row: ClientRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    address: row.address,
    createdAt: row.created_at,
  };
}

export function listClients(): Customer[] {
  const rows = getDb().prepare("SELECT * FROM clients ORDER BY name COLLATE NOCASE").all() as ClientRow[];
  return rows.map(map);
}

export function getClient(id: string): Customer | null {
  const row = getDb().prepare("SELECT * FROM clients WHERE id = ?").get(id) as
    | ClientRow
    | undefined;
  return row ? map(row) : null;
}

export function createClient(input: { name: string; email: string; address: string }): Customer {
  const client: Customer = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    address: input.address,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO clients (id, name, email, address, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(client.id, client.name, client.email, client.address, client.createdAt);
  return client;
}

/**
 * Updates a client and — in the same transaction — syncs the customer block
 * of that client's draft invoices. Issued and void invoices keep their
 * frozen snapshot untouched.
 */
export function updateClient(
  id: string,
  input: { name: string; email: string; address: string },
): Customer | null {
  const now = new Date().toISOString();
  return transact(() => {
    const db = getDb();
    const result = db
      .prepare("UPDATE clients SET name = ?, email = ?, address = ? WHERE id = ?")
      .run(input.name, input.email, input.address, id);
    if (Number(result.changes) === 0) return null;
    db.prepare(
      "UPDATE invoices SET customer_snapshot = ?, updated_at = ? WHERE customer_id = ? AND status = 'draft'",
    ).run(JSON.stringify({ name: input.name, email: input.email, address: input.address }), now, id);
    return getClient(id);
  });
}

export function deleteClient(id: string): boolean {
  // invoices.customer_id is nulled automatically (FK ON DELETE SET NULL).
  const result = getDb().prepare("DELETE FROM clients WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}
