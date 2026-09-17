// Installs the '@/' resolver. Use as:  node --import ./scripts/lib/register-ts.mjs <script>
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./ts-alias-loader.mjs', pathToFileURL(process.cwd() + '/scripts/lib/'));
