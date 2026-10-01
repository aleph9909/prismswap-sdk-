import { build } from 'esbuild'
const result = await build({stdin:{contents:"export * from './dist/index.js'; export * from './dist/wallet-standard.js'; export * from './dist/session/index.js';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,metafile:true})
const modules=Object.keys(result.metafile.inputs)
if(modules.some(p=>/server\/|worker\/|\.env/.test(p))) throw new Error('Private runtime reached the browser bundle')
console.log(`Browser bundle passed (${modules.length} modules); no Node-only imports or private runtime required.`)
