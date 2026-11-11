export const schema = [
  "CREATE TABLE IF NOT EXISTS selections (session_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS otp (email TEXT PRIMARY KEY,challenge TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY,owner TEXT NOT NULL,service_id TEXT NOT NULL,service_name TEXT NOT NULL,quantity INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,customer TEXT NOT NULL,payment_id TEXT UNIQUE,pix TEXT,provider_order TEXT,created_at TEXT NOT NULL)",
];
