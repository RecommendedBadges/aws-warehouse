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
RUN dnf install -y wget
RUN dnf install -y tar
#RUN wget https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-linux-x64.tar.gz
#RUN mkdir -p /tmp/cli/sf
#RUN tar -xf sf-linux-x64.tar.gz -C /tmp/cli/sf --strip-components 1
#RUN export PATH=/tmp/cli/sf/bin:$PATH
RUN npm install @salesforce/cli -g
#RUN sf -v
COPY package.json ./
RUN npm install --omit=dev
WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=builder /usr/app/dist/* ./
CMD ["index.handler"]