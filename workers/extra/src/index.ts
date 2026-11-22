interface Env {
  ASSETS: Fetcher;
}

/** Static files only; access control lives in the main Worker's /sym/extra/* gate. */
export default {
  fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
