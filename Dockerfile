FROM node:16
WORKDIR /engineering-data-distributor
COPY . .
RUN npm install
ENTRYPOINT ["npm", "start"]