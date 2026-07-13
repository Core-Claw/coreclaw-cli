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
  const response = await client.getAccount();
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const data = response.data ?? {};
  console.log('CoreClaw account');
  console.log(`Balance: ${data.balance ?? '-'}`);
  if (data.balance_expiration_at !== undefined && data.balance_expiration_at !== null) {
    console.log(`Balance expiration: ${data.balance_expiration_at}`);
  }
  return response;
}
