import { createHmac, pbkdf2Sync } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

const phrase = process.env.SEED_PHRASE ?? process.argv[2];
const bip39Path = process.env.SEED_PATH ?? process.argv[3] ?? "m/44'/148'/0'";

if (!phrase) {
  console.error('Usage: SEED_PHRASE="word1 word2 ..." node scripts/derive-keypair.mjs');
  console.error('       node scripts/derive-keypair.mjs "word1 word2 ..." [bip39-path]');
  process.exit(1);
}

function seedFromMnemonic(mnemonic) {
  const normalized = mnemonic.normalize('NFKD');
  return pbkdf2Sync(normalized, 'mnemonic', 2048, 64, 'sha512');
}

function deriveEd25519(seed, path) {
  const hmac = (key, data) => createHmac('sha512', key).update(data).digest();
  let I = hmac('ed25519 seed', seed);
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32);
  for (const segment of path.split('/').slice(1)) {
    const hardened = segment.endsWith("'");
    const index = Number.parseInt(segment, 10) + (hardened ? 0x80000000 : 0);
    const data = Buffer.alloc(1 + 32 + 4);
    data[0] = 0;
    key.copy(data, 1);
    data.writeUInt32BE(index, 33);
    I = hmac(chainCode, data);
    key = I.subarray(0, 32);
    chainCode = I.subarray(32);
  }
  return key;
}

const kp = Keypair.fromRawEd25519Seed(deriveEd25519(seedFromMnemonic(phrase), bip39Path));
console.log('SECRET:' + kp.secret());
console.log('PUBLIC:' + kp.publicKey());
console.log('PATH:  ' + bip39Path);
