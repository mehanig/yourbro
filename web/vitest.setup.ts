import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  // @ts-expect-error -- assigning Node's webcrypto to globalThis
  globalThis.crypto = webcrypto;
}
