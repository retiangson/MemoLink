# MemoLink backend — AWS Lambda container image
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY memolink_backend/ ./memolink_backend/

CMD ["memolink_backend.main.handler"]
