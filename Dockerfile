FROM public.ecr.aws/lambda/nodejs:latest AS builder
WORKDIR /usr/app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM public.ecr.aws/lambda/nodejs:latest
COPY package.json package-lock.json ${LAMBDA_TASK_ROOT}/
WORKDIR ${LAMBDA_TASK_ROOT}
RUN npm install --omit=dev
COPY --from=builder /usr/app/dist/* ./
CMD ["index.handler"]
