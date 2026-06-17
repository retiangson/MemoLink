# MemoLink backend — AWS Lambda container image
FROM public.ecr.aws/lambda/nodejs:20 AS node-runtime

FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# WhatsApp uses a Baileys Node.js bridge. Production must include Node because
# the Python backend starts the bridge as a subprocess.
COPY --from=node-runtime /var/lang/bin/node /usr/local/bin/node
COPY --from=node-runtime /var/lang/bin/npm /usr/local/bin/npm
COPY --from=node-runtime /var/lang/bin/npx /usr/local/bin/npx
COPY --from=node-runtime /var/lang/lib/node_modules /usr/local/lib/node_modules
ENV PATH="/usr/local/bin:${PATH}"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY memolink_backend/whatsapp_bridge/package*.json ./memolink_backend/whatsapp_bridge/
RUN npm ci --omit=dev --prefix memolink_backend/whatsapp_bridge

COPY memolink_backend/ ./memolink_backend/

CMD ["memolink_backend.main.handler"]
