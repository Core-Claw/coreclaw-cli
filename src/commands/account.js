import { createClientFromOptions, printOrReturn, requireSubcommand } from './cloud-utils.js';

export async function accountCommand(positionals = [], options = {}) {
  const subcommand = requireSubcommand(positionals, 'account', ['info']);
  if (subcommand === 'info') {
    return accountInfo(options);
  }
  return null;
}

async function accountInfo(options) {
  const client = createClientFromOptions(options);
  const response = await client.accountInfo();
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const data = response.data ?? {};
  console.log('CoreClaw account');
  console.log(`Balance: ${data.balance ?? '-'}`);
  console.log(`Traffic: ${data.traffic ?? '-'}`);
  if (data.traffic_expiration_at !== undefined && data.traffic_expiration_at !== null) {
    console.log(`Traffic expiration: ${data.traffic_expiration_at}`);
  }
  return response;
}
