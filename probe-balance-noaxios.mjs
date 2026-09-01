import { Horizon, Contract, Address, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk/no-axios';
import { Server as SorobanRpc, Api as SorobanApi } from '@stellar/stellar-sdk/no-axios/rpc';

const PUBLIC_KEY = 'GCGXCQE7UE5RLKAN2SLJLWAGXWE4MR3VUUUOHBVWJOOA2HKUQTJGKV5P';
const CONTRACT_ID = 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';

async function main() {
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(PUBLIC_KEY);
  console.log('account loaded, sequence:', account.sequenceNumber());

  const rpc = new SorobanRpc(RPC_URL);
  const operation = new Contract(CONTRACT_ID).call('balance', new Address(PUBLIC_KEY).toScVal());
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: PASSPHRASE })
    .addOperation(operation)
    .setTimeout(0)
    .build();
  console.log('tx built');

  try {
    const sim = await rpc.simulateTransaction(tx);
    console.log('sim keys:', Object.keys(sim));
    console.log('isSimulationError:', SorobanApi.isSimulationError(sim));
    if (SorobanApi.isSimulationError(sim)) {
      console.log('SIM ERROR:', sim.error);
      return;
    }
    console.log('result type:', typeof sim.result);
    console.log('result keys:', sim.result ? Object.keys(sim.result) : null);
    if (sim.result) {
      console.log('retval type:', typeof sim.result.retval, sim.result.retval?.constructor?.name);
      console.log('retval native:', scValToNative(sim.result.retval));
    }
  } catch (e) {
    console.log('THREW:', e instanceof Error ? e.message : String(e));
  }
}

main();
