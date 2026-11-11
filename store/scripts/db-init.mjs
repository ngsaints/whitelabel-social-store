import { sql } from "../worker/turso.js";
import { schema } from "../worker/schema.js";
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN)
  throw Error("Preencha TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no .env");
for (const statement of schema) await sql(process.env, statement);
console.log("Banco pronto: configurações, OTP, seleções e pedidos.");
