// Cofre das credenciais dos portais (senha ou certificado A1).
//
// Criptografia em nível de aplicação: AES-256-GCM com a chave CREDENCIAIS_CHAVE
// (32 bytes em base64), que existe SÓ no servidor. O banco guarda apenas o texto
// cifrado. Cada segredo é amarrado ao dono e ao portal (AAD "user_id:portal"):
// um texto cifrado copiado para outra conta ou outro portal não abre.
//
// Formato: "v1.<iv base64>.<tag base64>.<dados base64>"
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createSecureContext } from 'node:tls';

export class ErroCofre extends Error {
  constructor(mensagem, codigo = 'cofre') {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** Gera uma chave nova (para o .env). */
export const gerarChave = () => randomBytes(32).toString('base64');

export function criarCofre(chaveBase64) {
  const chave = Buffer.from(String(chaveBase64 || ''), 'base64');
  if (chave.length !== 32) {
    throw new ErroCofre('CREDENCIAIS_CHAVE ausente ou inválida: precisa ter 32 bytes em base64 (gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))").', 'sem_chave');
  }
  const aad = (dono, portal) => Buffer.from(`${dono}:${portal}`, 'utf8');

  return {
    /** Cifra um objeto (ex.: { login, senha }) para um dono e um portal. */
    cifrar(segredo, { dono, portal }) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', chave, iv);
      c.setAAD(aad(dono, portal));
      const dados = Buffer.concat([c.update(JSON.stringify(segredo), 'utf8'), c.final()]);
      return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.');
    },

    /** Abre um segredo. Falha se o texto foi alterado, se a chave mudou ou se o dono/portal não batem. */
    decifrar(texto, { dono, portal }) {
      const partes = String(texto || '').split('.');
      if (partes.length !== 4 || partes[0] !== 'v1') throw new ErroCofre('Credencial em formato desconhecido.', 'formato');
      try {
        const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(partes[1], 'base64'));
        d.setAAD(aad(dono, portal));
        d.setAuthTag(Buffer.from(partes[2], 'base64'));
        const aberto = Buffer.concat([d.update(Buffer.from(partes[3], 'base64')), d.final()]);
        return JSON.parse(aberto.toString('utf8'));
      } catch {
        throw new ErroCofre('Não consegui abrir a credencial (a chave do cofre mudou ou o dado foi alterado). Salve a credencial de novo.', 'violada');
      }
    },
  };
}

/** Confere se o .pfx abre com a senha informada (sem guardar nada). */
export function validarCertificado(pfx, senha) {
  try {
    createSecureContext({ pfx, passphrase: senha });
    return true;
  } catch (e) {
    const msg = /mac verify|bad decrypt|password/i.test(e.message) ? 'A senha do certificado não confere.' : 'O arquivo não é um certificado A1 (.pfx/.p12) válido.';
    throw new ErroCofre(msg, 'certificado');
  }
}

/** "12345678909" -> "123.***.***-09"; e-mail -> "jo***@dominio"; outro -> "ab***yz". Só para mostrar na tela. */
export function mascararLogin(login) {
  const t = String(login || '').trim();
  if (!t) return null;
  const dig = t.replace(/\D/g, '');
  if (/^[\d.\-/\s]+$/.test(t) && dig.length === 11) return `${dig.slice(0, 3)}.***.***-${dig.slice(9)}`;
  if (/^[\d.\-/\s]+$/.test(t) && dig.length === 14) return `${dig.slice(0, 2)}.***.***/****-${dig.slice(12)}`;
  const arroba = t.indexOf('@');
  if (arroba > 0) return `${t.slice(0, Math.min(2, arroba))}***${t.slice(arroba)}`;
  return t.length <= 4 ? '****' : `${t.slice(0, 2)}***${t.slice(-2)}`;
}
