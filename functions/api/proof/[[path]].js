// GET /api/proof/proof/<slug>/<file>: a proof screenshot from the PROOF R2 bucket. Screenshots are public, like the
// standings they back up.

import { fail } from '../../../lib/api.js';

export async function onRequestGet({ env, params }) {
  const key = (params.path || []).join('/');
  if (!/^proof\/[\w-]+\/[\w-]+\.(png|jpg|webp)$/.test(key)) return fail('Not a proof screenshot.', 404);
  if (!env.PROOF) return fail('No R2 bucket bound as PROOF.', 500);
  const object = await env.PROOF.get(key);
  if (!object) return fail('Screenshot not found.', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
