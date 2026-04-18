FROM python:3.12-slim

WORKDIR /app

COPY services/jobs/bazos/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/jobs/bazos/src/ .

CMD ["python", "main.py"]
