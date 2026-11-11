FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY store ./store
ENV HOST=0.0.0.0 PORT=4173
EXPOSE 4173
CMD ["npm","start"]
