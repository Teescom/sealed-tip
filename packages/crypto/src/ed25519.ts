import * as noble from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

// noble v3 ships hash-free; binding its own sha512 keeps browser and Node signatures identical.
noble.hashes.sha512 = sha512;

export { noble as ed };
