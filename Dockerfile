FROM bitnami/express:latest

WORKDIR /app
COPY . .

RUN npm install
EXPOSE 8787
