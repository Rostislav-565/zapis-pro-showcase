import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { one, run } from "./db.ts";
import { AppError, hash } from "./store.ts";

const lifetime = 8 * 60 * 60;
const cookie = "zapis_session";
export function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function login(req: IncomingMessage, username: string, password: string) {
  const ip = req.socket.remoteAddress || "local";
  const now = Date.now();
  const rate = one<{ attempts: number; expires: number }>("SELECT attempts,expires FROM login_attempts WHERE ip=?", ip);
  if (rate && rate.expires > now && rate.attempts >= 8) throw new AppError(429, "Слишком много попыток. Повторите через 15 минут");
  const record = one<{ passwordHash: string }>("SELECT passwordHash FROM admins WHERE login=?", username);
  const stored = record?.passwordHash || "00000000000000000000000000000000:" + "0".repeat(128);
  const computed = passwordHash(password, stored.split(":")[0]);
  if (!timingSafeEqual(Buffer.from(computed), Buffer.from(stored)) || !record) {
    run(`INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET
      attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END,
      expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END`, ip, now + 900_000, now, now);
    throw new AppError(401, "Неверный логин или пароль");
  }
  run("DELETE FROM login_attempts WHERE ip=?", ip);
  run("DELETE FROM sessions WHERE expires<=?", now);
  const token = randomBytes(32).toString("hex");
  run("INSERT INTO sessions VALUES(?,?,?)", hash(token), username, now + lifetime * 1000);
  return sessionCookie(token, lifetime);
}
function sessionCookie(token: string, age: number) {
  return `${cookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.SESSION_SECURE === "true" ? "; Secure" : ""}`;
}
function sessionToken(req: IncomingMessage) {
  return req.headers.cookie?.match(/(?:^|;\s*)zapis_session=([0-9a-f]{64})(?:;|$)/)?.[1];
}
export function hasSession(req: IncomingMessage) {
  const token = sessionToken(req);
  return !!token && !!one("SELECT login FROM sessions WHERE tokenHash=? AND expires>?", hash(token), Date.now());
}
export function requireAdmin(req: IncomingMessage) {
  if (!hasSession(req)) throw new AppError(401, "Войдите в панель администратора");
}
export function logout(req: IncomingMessage) {
  const token = sessionToken(req);
  if (token) run("DELETE FROM sessions WHERE tokenHash=?", hash(token));
  return sessionCookie("", 0);
}
