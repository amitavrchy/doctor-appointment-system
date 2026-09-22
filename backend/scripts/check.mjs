import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this through npm run check:all');
const backend=fileURLToPath(new URL('../',import.meta.url));
const frontend=fileURLToPath(new URL('../../frontend/',import.meta.url));
for(const [cwd,args] of [[backend,['run','db:generate']],[backend,['run','typecheck']],[backend,['test']],[backend,['run','build']],[frontend,['run','typecheck']],[frontend,['run','build']],[backend,['audit']],[frontend,['audit']],...(process.argv.includes('--browser')?[[frontend,['run','test:e2e']]]:[])]){
 const result=spawnSync(process.execPath,[npm,...args],{cwd,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
