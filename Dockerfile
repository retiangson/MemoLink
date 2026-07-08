# MemoLink backend — AWS Lambda container image

# Stage 1: install WhatsApp bridge deps where Node/npm actually works
FROM public.ecr.aws/lambda/nodejs:20 AS node-deps
WORKDIR /build
COPY memolink_backend/whatsapp_bridge/package*.json ./
RUN npm ci --omit=dev

WORKDIR /build/memolink_backend/book_parser
COPY patches/ /build/patches/
COPY memolink_backend/book_parser/package*.json ./
RUN npm ci

# Stage 2: main Python Lambda image
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# Copy just the node binary so the Python backend can spawn the bridge subprocess
COPY --from=node-deps /var/lang/bin/node /usr/local/bin/node
ENV PATH="/usr/local/bin:${PATH}"

COPY requirements.txt .
# Pillow (pulled in transitively by pdfplumber/python-pptx) ships wheels tagged
# manylinux_2_28 for recent releases, which this Amazon Linux 2 based image's
# glibc doesn't satisfy — pip falls back to a source build, which needs a
# compiler this base image doesn't ship. Install it, build, then strip it back
# out so the final Lambda image doesn't carry a full C toolchain.
RUN yum install -y gcc gcc-c++ make \
        libjpeg-turbo-devel zlib-devel libtiff-devel freetype-devel \
        lcms2-devel libwebp-devel tcl-devel tk-devel harfbuzz-devel fribidi-devel \
    && pip install --no-cache-dir -r requirements.txt \
    && yum remove -y gcc gcc-c++ make \
    && yum clean all \
    && rm -rf /var/cache/yum

COPY memolink_backend/ ./memolink_backend/

# Drop in the pre-built bridge node_modules (no npm needed at runtime)
COPY --from=node-deps /build/node_modules ./memolink_backend/whatsapp_bridge/node_modules/
COPY --from=node-deps /build/memolink_backend/book_parser/node_modules ./memolink_backend/book_parser/node_modules/

CMD ["memolink_backend.main.handler"]
