import { redirect } from './redirect.ts';

export default {
  fetch: (request) => redirect(request),
} satisfies ExportedHandler;
