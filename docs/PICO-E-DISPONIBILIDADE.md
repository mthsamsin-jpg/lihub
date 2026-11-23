# Picos de acesso e disponibilidade

## O que o app faz sozinho

- **Abertura:** se o servidor demora (Render acordando), o app mostra "Carregando… tentativa N de 4" e tenta de novo (1 s, 2 s, 4 s). Se não conseguir, mostra **"Tentar de novo"**. Não cai mais no modo demonstração por engano.
- **Leituras do banco** (buscas, listas, RPCs de consulta) são repetidas até 2 vezes em falha passageira (rede, 408/429/5xx, tempo esgotado). **Gravações nunca são repetidas.**
- **Erros visíveis:** busca de editais e radares mostram o erro com "Tentar de novo" em vez de ficar em branco. "Carregar mais" que falha não apaga a lista.
- **Horário de pico:** a coleta de inteligência de mercado não roda em seg–sex 18h–23h e sáb–dom 9h–23h (Brasília), para deixar o banco livre. A sincronização dos editais continua normalmente.

| Variável | Padrão | Uso |
|---|---|---|
| `PICO` | ligado | `0` desliga a pausa no pico |
| `PICO_HORAS_UTEIS` | `18-23` | horas de pico de segunda a sexta |
| `PICO_HORAS_FIM_SEMANA` | `9-23` | horas de pico no sábado e domingo |

## O que precisa ser feito fora do código

1. **Evitar o "SERVICE WAKING UP":** no plano gratuito, o Render desliga o serviço após ~15 min sem visitas.
   - Grátis: crie um monitor no UptimeRobot ou no cron-job.org chamando `https://usolicitahub.com.br/saude` a cada 10 minutos.
   - Recomendado para a divulgação: **Render Starter** (nunca dorme e tem mais memória).
2. **Supabase:** no plano gratuito, o projeto pausa após 7 dias sem uso e tem limite de conexões. Para tráfego de divulgação, acompanhe o uso em *Reports* no painel.
