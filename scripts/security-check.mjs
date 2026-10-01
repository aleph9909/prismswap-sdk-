import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = process.cwd(), excluded = new Set(['node_modules','.git','dist'])
const failures = new Set()
const patterns = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}\b/,
  /(?:postgres(?:ql)?|https?):\/\/[^\s/]+:[^\s/@]+@/,
  /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/,
]
const forbiddenBrand = ['swap','fun'].join('')
function scan(name,content) {
  if (patterns.some(re=>re.test(content))) failures.add(name+': secret pattern')
  if (content.toLowerCase().includes(forbiddenBrand)) failures.add(name+': private reference or obsolete branding')
  if (/(?:^|\/)\.env(?:$|\.)/.test(name) && !name.endsWith('.env.example')) failures.add(name+': environment file')
  if (/(?:keypair|id\.json|\.pem$|\.key$)/i.test(name)) failures.add(name+': credential file')
}
function walk(dir) { for (const f of readdirSync(dir,{withFileTypes:true})) { if (excluded.has(f.name)||f.name.endsWith('.tgz')) continue; const p=join(dir,f.name); if(f.isDirectory())walk(p);else scan(p.slice(root.length+1),readFileSync(p,'utf8')) } }
walk(root)
// Scan every retained blob, including files deleted from public branches.
let objects=[]
try { objects=execFileSync('git',['rev-list','--objects','--all'],{encoding:'utf8'}).trim().split('\n').filter(Boolean) } catch {}
for(const line of objects) {
  const [sha,...nameParts]=line.split(' ')
  if (execFileSync('git',['cat-file','-t',sha],{encoding:'utf8'}).trim()==='blob') scan('history/'+nameParts.join(' '),execFileSync('git',['cat-file','blob',sha],{encoding:'utf8'}))
}
if(failures.size) { console.error([...failures].join('\n'));process.exit(1) }
console.log('Source and retained Git history passed secret-pattern and public-reference checks. This scan is not proof of credential revocation or a full security audit.')
