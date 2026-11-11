import { randomBytes } from "node:crypto";
console.log("Cole estes valores no seu .env local, sem publicá-los:");
console.log("APP_ENCRYPTION_KEY=" + randomBytes(32).toString("hex"));
console.log("SETUP_TOKEN=" + randomBytes(32).toString("hex"));
