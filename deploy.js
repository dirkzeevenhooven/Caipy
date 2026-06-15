// deploy.js — upload static files to Plesk httpdocs/ over FTP
// Usage:
//   node deploy.js --test                 # connect + list httpdocs/
//   node deploy.js index.html             # upload one file
//   node deploy.js index.html guide/myguide.html   # upload several
// Files keep their relative path under httpdocs/ (e.g. guide/x.html -> httpdocs/guide/x.html)

const ftp = require('basic-ftp');
const path = require('path');
require('dotenv').config();

const { FTP_HOST, FTP_USER, FTP_PASS, FTP_SECURE } = process.env;

async function main() {
  if (!FTP_HOST || !FTP_USER || !FTP_PASS) {
    console.error('Missing FTP_HOST / FTP_USER / FTP_PASS in .env');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const testMode = args[0] === '--test';
  const files = testMode ? [] : args;

  if (!testMode && files.length === 0) {
    console.error('Nothing to deploy. Pass file paths, e.g.  node deploy.js index.html');
    process.exit(1);
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASS,
      secure: FTP_SECURE === 'true',
    });

    const base = await client.pwd();
    console.log(`Connected to ${FTP_HOST} (home: ${base})`);

    if (testMode) {
      await client.cd(base);
      const list = await client.list('httpdocs');
      console.log(`httpdocs/ contains ${list.length} entries. First 25:`);
      console.log(list.slice(0, 25).map(f => `  ${f.isDirectory ? '[d]' : '   '} ${f.name}`).join('\n'));
      return;
    }

    for (const f of files) {
      await client.cd(base);
      const sub = path.dirname(f);
      const remoteDir = sub === '.' ? 'httpdocs' : 'httpdocs/' + sub;
      await client.ensureDir(remoteDir); // creates dirs and cd's into remoteDir
      await client.uploadFrom(f, path.basename(f));
      console.log(`  uploaded  ${f}  ->  ${remoteDir}/${path.basename(f)}`);
    }
    console.log(`Done. Deployed ${files.length} file(s).`);
  } catch (err) {
    console.error('FTP error:', err.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
