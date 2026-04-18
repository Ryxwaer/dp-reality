FROM python:3.12-slim

WORKDIR /app

COPY proto/bot_module.proto /proto/bot_module.proto
COPY services/modules/bazos/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m grpc_tools.protoc -I/proto --python_out=. --grpc_python_out=. /proto/bot_module.proto

COPY services/modules/bazos/src/ .

CMD ["python", "main.py"]
