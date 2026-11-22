import { createApp } from './app.ts';

export { UserVault } from './vault/user-vault.ts';

const app = createApp();

export default app satisfies ExportedHandler<Cloudflare.Env>;
