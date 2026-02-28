FROM public.ecr.aws/lambda/nodejs:latest AS builder
WORKDIR /usr/app
COPY ./  ./
RUN npm install
RUN npm run build

FROM public.ecr.aws/lambda/nodejs:latest
RUN dnf remove -y microdnf-dnf
RUN microdnf install -y dnf
RUN dnf check-update
RUN dnf upgrade -y
RUN dnf install -y git
RUN dnf install -y openssl
ENV LD_LIBRARY_PATH=""
RUN openssl version
RUN alias npm-exec='PATH=$(npm bin):$PATH'
WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=builder /usr/app/dist/* ./
CMD ["index.handler"]