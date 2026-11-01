# خدمة واحدة: الواجهة (ملفات ثابتة) + API + العامل + MCP البعيد. غير مُجرَّب هنا (لا Docker في بيئة البناء) — راجع docs/PHONE.md
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY . .
RUN npx prisma generate && cd web && npm run build && cd .. && rm -rf web/node_modules web/.next

FROM node:22-bookworm-slim
# ffmpeg: فحص الفيديو واستخراج لقطات الذكاء الاصطناعي. openssl: مطلوب لمحرك Prisma
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 WEB_DIR=/app/web/out
COPY --from=build /app /app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx tsx src/api/main.ts"]
