import { sha256 } from '@noble/hashes/sha256';
import { mnemonicToSeed } from '@scure/bip39';
import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { generateMnemonicPhrase, isValidMnemonicPhrase } from '../src/lib/recovery';

describe('recovery mnemonic', () => {
  it('generates a valid 12-word mnemonic', () => {
    const mnemonic = generateMnemonicPhrase();
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(isValidMnemonicPhrase(mnemonic)).toBe(true);
  });

  it('rejects tampered mnemonics', () => {
    // BIP39 test vector: 11x abandon + "about" is valid; changing the final
    // word to "abandon" flips the embedded 4-bit checksum so it must fail.
    const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(isValidMnemonicPhrase(valid)).toBe(true);
    expect(isValidMnemonicPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon')).toBe(false);
    expect(isValidMnemonicPhrase('abandon abandon abandon')).toBe(false);
  });

  it('derives a deterministic keypair from the mnemonic', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const derive = async () => {
      const seed = await mnemonicToSeed(mnemonic);
      return Keypair.fromRawEd25519Seed(sha256(seed) as Buffer).publicKey();
    };
    expect(await derive()).toBe(await derive());
  });

  it('derives a keypair from a generated mnemonic', async () => {
    const mnemonic = generateMnemonicPhrase();
    const seed = await mnemonicToSeed(mnemonic);
    const keypair = Keypair.fromRawEd25519Seed(sha256(seed) as Buffer);
    expect(keypair.publicKey()).toMatch(/^G[A-Z2-7]{55}$/);
  });
});
