FROM node:20-alpine

WORKDIR /app

# tzdata so the Supervisor-provided TZ is honoured; curl drives the alert loop
RUN apk add --no-cache ca-certificates curl jq openssl tzdata

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run prisma:generate
RUN npm run build

RUN chmod +x /app/start.sh

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["/app/start.sh"]
