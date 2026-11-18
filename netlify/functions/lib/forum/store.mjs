// Netlify Blobs access with a swappable factory (tests inject an in-memory store).
import { getStore } from "@netlify/blobs";

export const STORE_NAMES = [
  "forum-users", "forum-names", "forum-codes", "forum-threads",
  "forum-reports", "forum-ratelimits", "forum-config",
];

let factory = (name) => getStore({ name, consistency: "strong" });
const cache = new Map();
let availability = null; // null = unknown, true/false after probe

export function setStoreFactory(fn) {
  factory = fn;
  cache.clear();
  availability = null;
}

export function resetStoreState() {
  cache.clear();
  availability = null;
}

export function store(name) {
  if (!cache.has(name)) cache.set(name, factory(name));
  return cache.get(name);
}

// Returns true if Blobs works in this environment. Never throws.
export async function blobsAvailable() {
  if (availability !== null) return availability;
  try {
    const s = store("forum-config");
    await s.get("probe", { type: "json" });
    availability = true;
  } catch (err) {
    availability = false;
  }
  return availability;
}

export function blobKey(s) {
  return encodeURIComponent(String(s)).replace(/%2F/gi, "_");
}

export async function getJSON(storeName, key) {
  const v = await store(storeName).get(key, { type: "json" });
  return v ?? null;
}

export async function setJSON(storeName, key, value) {
  await store(storeName).setJSON(key, value);
}

export async function del(storeName, key) {
  await store(storeName).delete(key);
}

// Sliding-window rate limiter. Records a hit only when allowed.
export async function rateHit(bucket, id, { limit, windowMs }, now = Date.now()) {
  const key = blobKey(bucket + ":" + id);
  const rec = (await getJSON("forum-ratelimits", key)) || { hits: [] };
  const hits = (rec.hits || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  hits.push(now);
  await setJSON("forum-ratelimits", key, { hits });
  return { ok: true };
}

// Check only (no hit recorded).
export async function rateCheck(bucket, id, { limit, windowMs }, now = Date.now()) {
  const key = blobKey(bucket + ":" + id);
  const rec = (await getJSON("forum-ratelimits", key)) || { hits: [] };
  const hits = (rec.hits || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  return { ok: true };
}

// Simple in-memory store with the subset of the Blobs API we use.
export function memoryStoreFactory() {
  const all = new Map();
  return (name) => {
    if (!all.has(name)) all.set(name, new Map());
    const m = all.get(name);
    return {
      async get(key, opts = {}) {
        if (!m.has(key)) return null;
        const raw = m.get(key);
        return opts.type === "json" ? JSON.parse(raw) : raw;
      },
      async setJSON(key, value) { m.set(key, JSON.stringify(value)); },
      async set(key, value) { m.set(key, String(value)); },
      async delete(key) { m.delete(key); },
      async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
      _map: m,
    };
  };
}

// A factory whose stores always throw, to simulate missing Blobs.
export function brokenStoreFactory() {
  return () => {
    const fail = async () => { throw new Error("Blobs unavailable"); };
    return { get: fail, setJSON: fail, set: fail, delete: fail, list: fail };
  };
}
