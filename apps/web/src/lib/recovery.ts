import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export function generateMnemonicPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export function isValidMnemonicPhrase(phrase: string): boolean {
  return validateMnemonic(phrase, wordlist);
}
