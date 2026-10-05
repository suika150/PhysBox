FROM node:20-slim

RUN apt-get update && apt-get install -y git curl \
    && npm install -g @anthropic-ai/claude-code@latest \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ブラウザ本体は全ユーザーが読める場所へ。
# 既定の $HOME/.cache/ms-playwright だと root が持ち主になり guest から実行できない
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
# /app 配下に node_modules を置くとバインドマウントに覆い隠されるので、
# グローバルに入れて NODE_PATH で require() から引けるようにする
ENV NODE_PATH=/usr/local/lib/node_modules

RUN npm install -g playwright@1.62.1 \
    && playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m guest
RUN mkdir /app && chown -R guest:guest /app
WORKDIR /app
USER guest