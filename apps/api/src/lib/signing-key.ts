import { readFileSync } from "node:fs";
import { SignJWT, importJWK, type JWK } from "jose";
import { randomUUID } from "node:crypto";

const cache = new Map<string, { key: Awaited<ReturnType<typeof importJWK>>; jwk: JWK }>();

export async function signClientAssertion(opts: {
  keyPath: string;
  clientId: string;
  audience: string;
}) {
  let entry = cache.get(opts.keyPath);
  if (!entry) {
    const jwk = JSON.parse(readFileSync(opts.keyPath, "utf8")) as JWK;
    if (!jwk.d) {
      throw new Error(`Signing key at ${opts.keyPath} is missing private component (d)`);
    }
    entry = { key: await importJWK(jwk, "RS256"), jwk };
    cache.set(opts.keyPath, entry);
  }
  const { key, jwk } = entry;
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid as string })
    .setIssuer(opts.clientId)
    .setSubject(opts.clientId)
    .setAudience(opts.audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(key);
}
