# MemoLink backend — AWS Lambda container image

# Stage 1: install WhatsApp bridge deps where Node/npm actually works
FROM public.ecr.aws/lambda/nodejs:20 AS node-deps
WORKDIR /build
COPY memolink_backend/whatsapp_bridge/package*.json ./
RUN npm ci --omit=dev

# Stage 2: main Python Lambda image
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# Copy just the node binary so the Python backend can spawn the bridge subprocess
COPY --from=node-deps /var/lang/bin/node /usr/local/bin/node
ENV PATH="/usr/local/bin:${PATH}"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY memolink_backend/ ./memolink_backend/

# Drop in the pre-built bridge node_modules (no npm needed at runtime)
COPY --from=node-deps /build/node_modules ./memolink_backend/whatsapp_bridge/node_modules/

CMD ["memolink_backend.main.handler"]
