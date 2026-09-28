/**
 * Lets a plain .mjs script import the app's TypeScript services directly.
 *
 * Node 22+ strips types from .ts on its own. What it cannot do is follow TypeScript's two
 * resolution conventions: the '@/' path alias from tsconfig, and extensionless relative
 * imports ('./carrier.service'). This hook supplies both.
 *
 * The point is that scripts run the SAME rules as the app. scripts/regrade.mjs previously
 * kept its own copy of grade.service's logic, the copy fell behind the condo exemption,
 * and a write pass would have moved 769 leads out of Grade A. A second implementation of
 * a rule is a second thing to get wrong.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = pathToFileURL(process.cwd() + '/src/').href;
const EXTS = ['.ts', '.tsx', '/index.ts', ''];

/** First candidate that exists on disk, else null. */
function firstExisting(base) {
  for (const ext of EXTS) {
    const url = base + ext;
    try { if (existsSync(new URL(url))) return url; } catch { /* not a file: URL */ }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  /**
   * Next's subpath exports, which Node will not resolve outside a Next build.
   *
   * A route handler imports 'next/server' for NextRequest/NextResponse, and without this a
   * script cannot import a route at all — so route handlers were the one layer with no way
   * to test them from here, and the only alternative was to trust that the thin bit on top
   * of a tested service was right.
   */
  if (specifier === 'next/server') return next('next/server.js', context);
  if (specifier.startsWith('@/')) {
    const hit = firstExisting(SRC + specifier.slice(2));
    if (hit) return next(hit, context);
  }
  // Relative import with no extension, as TypeScript writes them.
  if (specifier.startsWith('.') && context.parentURL) {
    const hit = firstExisting(new URL(specifier, context.parentURL).href);
    if (hit) return next(hit, context);
  }
  return next(specifier, context);
}
