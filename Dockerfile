# Uso LicitaHub: servidor (API + site) + worker do Robô Turbo 2.0 (Playwright).
#
# A imagem oficial do Playwright já traz o Chromium e TODAS as bibliotecas de
# sistema que ele precisa (o que falta no Node "nativo" do Render).
# IMPORTANTE: a versão da imagem tem que ser IGUAL à do pacote "playwright" do
# package.json (1.48.2). Se atualizar um, atualize o outro.
FROM mcr.microsoft.com/playwright:v1.48.2-noble

# O projeto pede Node 22 (package.json > engines). Copia o Node 22 oficial por
# cima do Node que vem na imagem (/usr/local/bin vem antes de /usr/bin no PATH).
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version

ENV NODE_ENV=production \
    # O Chromium já está na imagem: não baixa outro no npm ci.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    ROBO_REAL_HEADLESS=sim

WORKDIR /app

# Dependências primeiro (cache das camadas).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY worker ./worker
COPY site ./site
COPY supabase ./supabase
COPY scripts ./scripts

# Roda como o usuário sem privilégios da imagem do Playwright (o Chromium não
# precisa de --no-sandbox assim).
RUN chown -R pwuser:pwuser /app
USER pwuser

# O Render informa a porta em PORT; o servidor lê PORTA. As demais variáveis
# (SUPABASE_*, CREDENCIAIS_CHAVE, MP_*, SITE_URL...) vêm do painel do Render.
EXPOSE 8787
CMD ["sh", "-c", "PORTA=${PORTA:-${PORT:-8787}} exec node src/servidor.js"]
