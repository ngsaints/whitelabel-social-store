export async function migrateOrders(execute) {
  const result = await execute("PRAGMA table_info(orders)");
  const nameIndex = result.cols.findIndex((c) => c.name === "name");
  const columns = new Set(result.rows.map((row) => row[nameIndex].value));
  for (const [name, type] of [
    ["payment_provider", "TEXT NOT NULL DEFAULT 'revantpay'"],
    ["checkout_url", "TEXT"],
    ["payment_intent", "TEXT"],
  ])
    if (!columns.has(name))
      await execute("ALTER TABLE orders ADD COLUMN " + name + " " + type);
  await execute(
    "CREATE INDEX IF NOT EXISTS orders_payment_intent ON orders(payment_intent)",
  );
}
