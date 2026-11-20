#!/usr/bin/env node
// Gera o hash da senha do modo ADM para colocar em ADMIN_LOGIN_PASSWORD_HASH (Render).
//   npm run adm:hash            pergunta a senha (sem mostrar na tela)
//   npm run adm:hash -- --segredo   também gera um ADMIN_SESSION_SECRET aleatório
import { randomBytes } from 'node:crypto';
import { gerarHash } from '../src/api/adm.js';

async function lerSenha(pergunta) {
  process.stdout.write(pergunta);
  const { stdin } = process;
  if (!stdin.isTTY) { let s = ''; for await (const p of stdin) s += p; return s.replace(/\r?\n$/, ''); }
  stdin.setRawMode(true);
  stdin.resume();
  let senha = '';
  return new Promise((resolve) => {
    stdin.on('data', (b) => {
      for (const ch of b.toString('utf8')) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); resolve(senha); return; }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f' || ch === '\b') senha = senha.slice(0, -1); else senha += ch;
      }
    });
  });
}

const senha = await lerSenha('Senha do ADM (mín. 12 caracteres): ');
if (senha.length < 12) { console.error('Use pelo menos 12 caracteres.'); process.exit(1); }
console.log(`\nADMIN_LOGIN_PASSWORD_HASH=${await gerarHash(senha)}`);
if (process.argv.includes('--segredo')) console.log(`ADMIN_SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
console.log('\nCopie para as variáveis do Render (Environment) e salve.');
